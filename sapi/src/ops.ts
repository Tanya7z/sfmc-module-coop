/**
 * 合作社业务操作：建社/入退/转让/踢人/金库/解散；资金与审计全部委托上游。
 */

import { service, ServiceError } from "@sfmc-bds/sdk/sapi/service";
import { db } from "@sfmc-bds/sdk/sapi/db";
import {
  canDissolve,
  canKick,
  canKickTarget,
  canManageRoles,
  canTransfer,
  canWithdraw,
  coopAccountId,
  memberRowId,
  newCid,
  validateAmount,
  validateCoopName,
  type CoopAuditAction,
  type CoopRole,
} from "./rules.js";
import {
  COOPS_TABLE,
  findCoopByName,
  findMembership,
  getCoop,
  getMember,
  listCoops,
  listMembers,
  MEMBERS_TABLE,
  type CoopRow,
  type MemberRow,
} from "./store.js";

export interface Actor {
  playerId: string;
  playerName: string;
}

function fail(message: string, code = "invalid_argument", status = 400): never {
  throw new ServiceError(message, code, status);
}

/** 异步上报治理审计（失败不阻断主路径，由调用方 catch 或 fire-and-forget）。 */
export async function recordAudit(input: {
  action: CoopAuditAction;
  actorId: string;
  actorName?: string;
  targetId: string;
  level?: "info" | "warn" | "error";
  payload?: Record<string, unknown>;
}): Promise<void> {
  await service.call("activity.record", {
    eventType: "coop.audit",
    actorId: input.actorId,
    actorName: input.actorName,
    targetId: input.targetId,
    level: input.level ?? "info",
    payload: { action: input.action, ...(input.payload ?? {}) },
  });
}

async function softAudit(input: Parameters<typeof recordAudit>[0]): Promise<void> {
  try {
    await recordAudit(input);
  } catch {
    /* 审计弱依赖：主路径已成功时不因日志失败回滚 */
  }
}

export async function createCoop(actor: Actor, rawName: string): Promise<{ cid: string; name: string }> {
  const nameErr = validateCoopName(rawName);
  if (nameErr) fail(nameErr);
  const name = rawName.trim();

  const existing = await findMembership(actor.playerId);
  if (existing) fail("你已加入合作社，请先退社", "already_member", 409);

  const nameHit = await findCoopByName(name);
  if (nameHit) fail("社名已被占用", "name_taken", 409);

  const cid = newCid();
  const now = Date.now();
  const coop: CoopRow = {
    cid,
    name,
    owner_id: actor.playerId,
    owner_name: actor.playerName,
    member_count: 1,
    created_at: now,
    updated_at: now,
  };
  const member: MemberRow = {
    id: memberRowId(cid, actor.playerId),
    cid,
    player_id: actor.playerId,
    player_name: actor.playerName,
    role: "owner",
    joined_at: now,
  };

  await db.tx(async (tx) => {
    await tx.insert(COOPS_TABLE, coop as unknown as Record<string, unknown>);
    await tx.insert(MEMBERS_TABLE, member as unknown as Record<string, unknown>);
  });

  await softAudit({
    action: "create",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: cid,
    payload: { name },
  });

  return { cid, name };
}

export async function joinCoop(actor: Actor, cidOrName: string): Promise<{ cid: string; name: string }> {
  const key = cidOrName.trim();
  if (!key) fail("请指定合作社 ID 或社名");

  const existing = await findMembership(actor.playerId);
  if (existing) fail("你已加入合作社，请先退社", "already_member", 409);

  let coop = await getCoop(key);
  if (!coop) coop = await findCoopByName(key);
  if (!coop) fail("合作社不存在", "not_found", 404);

  const now = Date.now();
  const member: MemberRow = {
    id: memberRowId(coop.cid, actor.playerId),
    cid: coop.cid,
    player_id: actor.playerId,
    player_name: actor.playerName,
    role: "member",
    joined_at: now,
  };

  await db.tx(async (tx) => {
    await tx.insert(MEMBERS_TABLE, member as unknown as Record<string, unknown>);
    await tx.update(COOPS_TABLE, coop!.cid, {
      member_count: (Number(coop!.member_count) || 0) + 1,
      updated_at: now,
    });
  });

  await softAudit({
    action: "join",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: coop.cid,
  });

  return { cid: coop.cid, name: coop.name };
}

export async function leaveCoop(actor: Actor): Promise<{ cid: string }> {
  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);

  if (membership.role === "owner") {
    fail("社长须先转让社长或解散合作社后再退出", "owner_must_transfer", 409);
  }

  const coop = await getCoop(membership.cid);
  const now = Date.now();
  await db.tx(async (tx) => {
    await tx.delete(MEMBERS_TABLE, membership.id);
    if (coop) {
      await tx.update(COOPS_TABLE, coop.cid, {
        member_count: Math.max(0, (Number(coop.member_count) || 1) - 1),
        updated_at: now,
      });
    }
  });

  await softAudit({
    action: "leave",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
  });

  return { cid: membership.cid };
}

export async function transferOwner(actor: Actor, targetPlayerId: string): Promise<{ cid: string }> {
  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);
  if (!canTransfer(membership.role as CoopRole)) fail("仅社长可转让", "forbidden", 403);

  const target = await getMember(membership.cid, targetPlayerId);
  if (!target) fail("目标不是本社成员", "not_found", 404);
  if (target.player_id === actor.playerId) fail("不能转让给自己");

  const now = Date.now();
  await db.tx(async (tx) => {
    await tx.update(MEMBERS_TABLE, membership.id, { role: "admin" });
    await tx.update(MEMBERS_TABLE, target.id, { role: "owner" });
    await tx.update(COOPS_TABLE, membership.cid, {
      owner_id: target.player_id,
      owner_name: target.player_name,
      updated_at: now,
    });
  });

  await softAudit({
    action: "transfer",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
    level: "warn",
    payload: { newOwnerId: target.player_id, newOwnerName: target.player_name },
  });

  return { cid: membership.cid };
}

export async function kickMember(actor: Actor, targetPlayerId: string): Promise<{ cid: string }> {
  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);
  if (!canKick(membership.role as CoopRole)) fail("无权踢人", "forbidden", 403);

  const target = await getMember(membership.cid, targetPlayerId);
  if (!target) fail("目标不是本社成员", "not_found", 404);
  if (!canKickTarget(membership.role as CoopRole, target.role as CoopRole)) {
    fail("不能踢出该成员", "forbidden", 403);
  }

  const coop = await getCoop(membership.cid);
  const now = Date.now();
  await db.tx(async (tx) => {
    await tx.delete(MEMBERS_TABLE, target.id);
    if (coop) {
      await tx.update(COOPS_TABLE, coop.cid, {
        member_count: Math.max(0, (Number(coop.member_count) || 1) - 1),
        updated_at: now,
      });
    }
  });

  await softAudit({
    action: "kick",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
    level: "warn",
    payload: { kickedId: target.player_id, kickedName: target.player_name },
  });

  return { cid: membership.cid };
}

export async function promoteMember(
  actor: Actor,
  targetPlayerId: string,
  role: "admin" | "member",
): Promise<{ cid: string }> {
  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);
  if (!canManageRoles(membership.role as CoopRole)) fail("仅社长可调整职务", "forbidden", 403);

  const target = await getMember(membership.cid, targetPlayerId);
  if (!target) fail("目标不是本社成员", "not_found", 404);
  if (target.role === "owner") fail("不能变更社长职务", "forbidden", 403);

  await db.tx(async (tx) => {
    await tx.update(MEMBERS_TABLE, target.id, { role });
  });

  await softAudit({
    action: role === "admin" ? "promote" : "demote",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
    payload: { targetId: target.player_id, role },
  });

  return { cid: membership.cid };
}

export async function depositBank(actor: Actor, amountRaw: unknown): Promise<{ balanceHint?: number }> {
  const amount = validateAmount(amountRaw);
  if (typeof amount === "string") fail(amount);

  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);

  const accountId = coopAccountId(membership.cid);
  const result = (await service.call("economy.account.transfer", {
    fromAccountId: actor.playerId,
    toAccountId: accountId,
    amount,
    actorId: actor.playerId,
    reason: "coop.deposit",
    referenceType: "coop",
    referenceId: membership.cid,
  })) as { balance?: number };

  await softAudit({
    action: "deposit",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
    payload: { amount, accountId },
  });

  return { balanceHint: result?.balance };
}

export async function withdrawBank(actor: Actor, amountRaw: unknown): Promise<{ balanceHint?: number }> {
  const amount = validateAmount(amountRaw);
  if (typeof amount === "string") fail(amount);

  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);
  if (!canWithdraw(membership.role as CoopRole)) {
    fail("普通成员无权提现，仅社长/管理员可操作", "forbidden", 403);
  }

  const accountId = coopAccountId(membership.cid);
  const result = (await service.call("economy.account.transfer", {
    fromAccountId: accountId,
    toAccountId: actor.playerId,
    amount,
    actorId: actor.playerId,
    reason: "coop.withdraw",
    referenceType: "coop",
    referenceId: membership.cid,
  })) as { balance?: number };

  await softAudit({
    action: "withdraw",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
    level: "warn",
    payload: { amount, accountId },
  });

  return { balanceHint: result?.balance };
}

export async function getBankBalance(cid: string): Promise<number> {
  const res = (await service.call("economy.account.get", {
    accountId: coopAccountId(cid),
  })) as { balance?: number };
  return typeof res?.balance === "number" ? res.balance : 0;
}

export async function dissolveCoop(actor: Actor): Promise<{ cid: string }> {
  const membership = await findMembership(actor.playerId);
  if (!membership) fail("你不在任何合作社中", "not_member", 404);
  if (!canDissolve(membership.role as CoopRole)) fail("仅社长可解散", "forbidden", 403);

  const members = await listMembers(membership.cid);
  await db.tx(async (tx) => {
    for (const m of members) {
      await tx.delete(MEMBERS_TABLE, m.id);
    }
    await tx.delete(COOPS_TABLE, membership.cid);
  });

  await softAudit({
    action: "dissolve",
    actorId: actor.playerId,
    actorName: actor.playerName,
    targetId: membership.cid,
    level: "warn",
  });

  return { cid: membership.cid };
}

export async function rankCoops(limit = 10): Promise<
  Array<{ rank: number; cid: string; name: string; memberCount: number; bankBalance: number }>
> {
  const coops = await listCoops(limit);
  const items = [];
  for (let i = 0; i < coops.length; i++) {
    const c = coops[i]!;
    let bankBalance = 0;
    try {
      bankBalance = await getBankBalance(c.cid);
    } catch {
      bankBalance = 0;
    }
    items.push({
      rank: i + 1,
      cid: c.cid,
      name: c.name,
      memberCount: Number(c.member_count) || 0,
      bankBalance,
    });
  }
  return items;
}

export async function serviceById(input: Record<string, unknown>) {
  const cid = String(input.cid ?? "");
  if (!cid) return null;
  const coop = await getCoop(cid);
  if (!coop) return null;
  let bankBalance = 0;
  try {
    bankBalance = await getBankBalance(cid);
  } catch {
    /* ignore */
  }
  return {
    cid: coop.cid,
    name: coop.name,
    ownerId: coop.owner_id,
    ownerName: coop.owner_name,
    memberCount: Number(coop.member_count) || 0,
    bankAccountId: coopAccountId(coop.cid),
    bankBalance,
    createdAt: Number(coop.created_at) || 0,
    updatedAt: Number(coop.updated_at) || 0,
  };
}

export async function serviceList(input: Record<string, unknown>) {
  const limit = typeof input.limit === "number" ? input.limit : 50;
  const coops = await listCoops(limit);
  return {
    items: coops.map((c) => ({
      cid: c.cid,
      name: c.name,
      ownerId: c.owner_id,
      ownerName: c.owner_name,
      memberCount: Number(c.member_count) || 0,
      bankAccountId: coopAccountId(c.cid),
      createdAt: Number(c.created_at) || 0,
    })),
  };
}

export async function serviceByPlayer(input: Record<string, unknown>) {
  const playerId = String(input.playerId ?? "");
  if (!playerId) return null;
  const membership = await findMembership(playerId);
  if (!membership) return { playerId, membership: null, coop: null };
  const coop = await getCoop(membership.cid);
  return {
    playerId,
    membership: {
      cid: membership.cid,
      role: membership.role,
      joinedAt: Number(membership.joined_at) || 0,
      playerName: membership.player_name,
    },
    coop: coop
      ? {
          cid: coop.cid,
          name: coop.name,
          ownerId: coop.owner_id,
          memberCount: Number(coop.member_count) || 0,
          bankAccountId: coopAccountId(coop.cid),
        }
      : null,
  };
}

export { listMembers, findMembership, getCoop };
