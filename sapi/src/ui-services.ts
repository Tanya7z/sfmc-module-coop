/** 声明式合作社页面使用的窄 service 适配层。 */

import { world } from "@minecraft/server";
import {
  createCoop,
  depositBank,
  dissolveCoop,
  findMembership,
  getBankBalance,
  getCoop,
  joinCoop,
  kickMember,
  leaveCoop,
  listMembers,
  promoteMember,
  rankCoops,
  transferOwner,
  withdrawBank,
  type Actor,
} from "./ops.js";
import {
  canDissolve,
  canKick,
  canKickTarget,
  canManageRoles,
  canTransfer,
  canWithdraw,
  resolveMemberRole,
  roleLabel,
} from "./rules.js";

function actor(input: Record<string, unknown>): Actor {
  const playerId = String(input.playerId ?? "");
  const player = world.getAllPlayers().find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("玩家不在线");
  return { playerId: player.id, playerName: player.name };
}

async function overview(input: Record<string, unknown>) {
  const current = actor(input);
  const membership = await findMembership(current.playerId);
  if (!membership) {
    return {
      membership: null,
      coop: null,
      bankBalance: 0,
      canWithdraw: false,
      canTransfer: false,
      canKick: false,
      canDissolve: false,
      canManageRoles: false,
    };
  }
  const coop = await getCoop(membership.cid);
  const role = resolveMemberRole(
    membership.role,
    coop?.owner_id,
    current.playerId,
  );
  return {
    membership: {
      cid: membership.cid,
      role,
      roleLabel: roleLabel(role),
    },
    coop: coop
      ? {
          cid: coop.cid,
          name: coop.name,
          ownerName: coop.owner_name,
          memberCount: Number(coop.member_count) || 0,
        }
      : null,
    bankBalance: await getBankBalance(membership.cid),
    canWithdraw: canWithdraw(role),
    canTransfer: canTransfer(role),
    canKick: canKick(role),
    canDissolve: canDissolve(role),
    canManageRoles: canManageRoles(role),
  };
}

async function members(input: Record<string, unknown>) {
  const current = actor(input);
  const membership = await findMembership(current.playerId);
  if (!membership) throw new Error("你不在任何合作社中");
  const coop = await getCoop(membership.cid);
  const role = resolveMemberRole(
    membership.role,
    coop?.owner_id,
    current.playerId,
  );
  const rows = await listMembers(membership.cid);
  const items = rows
    .filter((row) => row.player_id !== current.playerId)
    .map((row) => {
      const targetRole = resolveMemberRole(
        row.role,
        coop?.owner_id,
        row.player_id,
      );
      return {
        playerId: row.player_id,
        playerName: row.player_name,
        role: targetRole,
        roleLabel: roleLabel(targetRole),
        canTransfer: canTransfer(role),
        canKick: canKickTarget(role, targetRole),
        canPromote: canManageRoles(role) && targetRole === "member",
        canDemote: canManageRoles(role) && targetRole === "admin",
      };
    });
  const promotableItems = items
    .filter((row) => row.canPromote)
    .map((row) => ({ playerId: row.playerId, playerName: row.playerName }));
  const demotableItems = items
    .filter((row) => row.canDemote)
    .map((row) => ({ playerId: row.playerId, playerName: row.playerName }));
  return {
    canManageRoles: canManageRoles(role),
    items,
    promotableItems,
    demotableItems,
    promotableCount: promotableItems.length,
    demotableCount: demotableItems.length,
  };
}

/**
 * 社长任命/撤职管理员。role 只接受 admin 或 member。
 * 使用场景：成员管理页「任命管理员」「降为成员」按钮。
 */
async function setRole(input: Record<string, unknown>) {
  const targetPlayerId = String(input.targetPlayerId ?? "").trim();
  if (!targetPlayerId) throw new Error("请选择成员");
  const next = String(input.role ?? "") === "admin" ? "admin" : "member";
  await promoteMember(actor(input), targetPlayerId, next);
  return { ok: true };
}

export const coopUiServices: Record<string, (input: Record<string, unknown>) => unknown | Promise<unknown>> = {
  "coop.ui.overview": overview,
  "coop.ui.members": members,
  "coop.ui.rank": async (input) => ({ items: await rankCoops(Number(input.limit) || 10) }),
  "coop.ui.create": (input) => createCoop(actor(input), String(input.name ?? "")),
  "coop.ui.join": (input) => joinCoop(actor(input), String(input.key ?? "")),
  "coop.ui.leave": (input) => leaveCoop(actor(input)),
  "coop.ui.deposit": (input) => depositBank(actor(input), Number(input.amount)),
  "coop.ui.withdraw": (input) => withdrawBank(actor(input), Number(input.amount)),
  "coop.ui.transfer": (input) => transferOwner(actor(input), String(input.targetPlayerId ?? "")),
  "coop.ui.kick": (input) => kickMember(actor(input), String(input.targetPlayerId ?? "")),
  "coop.ui.promote": setRole,
  "coop.ui.dissolve": (input) => dissolveCoop(actor(input)),
};
