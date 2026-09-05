/**
 * 合作社领域表读写（仅维护关系实体；余额/审计委托上游）。
 */

import { db } from "@sfmc-bds/sdk/sapi/db";
import { memberRowId, type CoopRole } from "./rules.js";

export const COOPS_TABLE = "sfmc_coops";
export const MEMBERS_TABLE = "sfmc_coop_members";

export interface CoopRow {
  cid: string;
  name: string;
  owner_id: string;
  owner_name: string;
  member_count: number;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

export interface MemberRow {
  id: string;
  cid: string;
  player_id: string;
  player_name: string;
  role: CoopRole;
  joined_at: number;
  [key: string]: unknown;
}

export async function defineCoopTables(): Promise<void> {
  await db.defineTable(COOPS_TABLE, {
    cid: { type: "TEXT", primary: true },
    name: { type: "TEXT", notNull: true, index: true },
    owner_id: { type: "TEXT", notNull: true, index: true },
    owner_name: { type: "TEXT", default: "" },
    member_count: { type: "INTEGER", default: 1, index: true },
    created_at: { type: "INTEGER", default: 0 },
    updated_at: { type: "INTEGER", default: 0 },
  });
  await db.defineTable(MEMBERS_TABLE, {
    id: { type: "TEXT", primary: true },
    cid: { type: "TEXT", notNull: true, index: true },
    player_id: { type: "TEXT", notNull: true, index: true },
    player_name: { type: "TEXT", default: "" },
    role: { type: "TEXT", default: "member" },
    joined_at: { type: "INTEGER", default: 0 },
  });
}

export async function getCoop(cid: string): Promise<CoopRow | null> {
  return (await db.get<CoopRow>(COOPS_TABLE, cid)) ?? null;
}

export async function getMember(cid: string, playerId: string): Promise<MemberRow | null> {
  return (await db.get<MemberRow>(MEMBERS_TABLE, memberRowId(cid, playerId))) ?? null;
}

export async function findMembership(playerId: string): Promise<MemberRow | null> {
  const rows = await db.query<MemberRow>(MEMBERS_TABLE, {
    where: { eq: ["player_id", playerId] },
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function listMembers(cid: string): Promise<MemberRow[]> {
  return db.query<MemberRow>(MEMBERS_TABLE, {
    where: { eq: ["cid", cid] },
    orderBy: { field: "joined_at", dir: "asc" },
  });
}

export async function listCoops(limit = 50): Promise<CoopRow[]> {
  const n = Math.min(100, Math.max(1, limit));
  return db.query<CoopRow>(COOPS_TABLE, {
    orderBy: { field: "member_count", dir: "desc" },
    limit: n,
  });
}

export async function findCoopByName(name: string): Promise<CoopRow | null> {
  const rows = await db.query<CoopRow>(COOPS_TABLE, {
    where: { eq: ["name", name.trim()] },
    limit: 1,
  });
  return rows[0] ?? null;
}
