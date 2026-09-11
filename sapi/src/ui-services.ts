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
  rankCoops,
  transferOwner,
  withdrawBank,
  type Actor,
} from "./ops.js";
import { canDissolve, canKick, canKickTarget, canTransfer, canWithdraw, roleLabel, type CoopRole } from "./rules.js";

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
    };
  }
  const coop = await getCoop(membership.cid);
  const role = membership.role as CoopRole;
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
  };
}

async function members(input: Record<string, unknown>) {
  const current = actor(input);
  const membership = await findMembership(current.playerId);
  if (!membership) throw new Error("你不在任何合作社中");
  const role = membership.role as CoopRole;
  const rows = await listMembers(membership.cid);
  return {
    items: rows
      .filter((row) => row.player_id !== current.playerId)
      .map((row) => ({
        playerId: row.player_id,
        playerName: row.player_name,
        role: row.role,
        roleLabel: roleLabel(row.role as CoopRole),
        canTransfer: canTransfer(role),
        canKick: canKickTarget(role, row.role as CoopRole),
      })),
  };
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
  "coop.ui.dissolve": (input) => dissolveCoop(actor(input)),
};
