/**
 * 合作社纯规则：角色门禁、公账账户标识、名称校验（无 Minecraft / db 依赖）。
 */

/** 成员角色：社长 / 管理员 / 普通成员。 */
export type CoopRole = "owner" | "admin" | "member";

/** 治理动作（审计 payload.action）。 */
export type CoopAuditAction =
  | "create"
  | "join"
  | "leave"
  | "transfer"
  | "kick"
  | "withdraw"
  | "deposit"
  | "dissolve"
  | "promote"
  | "demote";

/** economy 托管公账标识：`coop:<cid>`。 */
export function coopAccountId(cid: string): string {
  return `coop:${cid}`;
}

/** 生成合作社短 id。 */
export function newCid(now = Date.now(), rand = Math.random()): string {
  const r = Math.floor(rand * 1e6)
    .toString(36)
    .padStart(4, "0");
  return `c_${now.toString(36)}_${r}`;
}

/** 成员表主键。 */
export function memberRowId(cid: string, playerId: string): string {
  return `${cid}:${playerId}`;
}

/** 社名合法性：非空、长度上限、禁止冒号（避免与账户命名空间混淆）。 */
export function validateCoopName(name: string): string | null {
  const n = name.trim();
  if (!n) return "社名不能为空";
  if (n.length > 24) return "社名最长 24 字";
  if (n.includes(":")) return "社名不能包含冒号";
  return null;
}

/** 金额：正整数。 */
export function validateAmount(amount: unknown): number | string {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return "金额须为正整数";
  }
  return amount;
}

/** 是否可提现（仅社长/社管）。 */
export function canWithdraw(role: CoopRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** 是否可踢人（仅社长/社管）。 */
export function canKick(role: CoopRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** 是否可转让社长（仅社长）。 */
export function canTransfer(role: CoopRole | null | undefined): boolean {
  return role === "owner";
}

/** 是否可解散（仅社长）。 */
export function canDissolve(role: CoopRole | null | undefined): boolean {
  return role === "owner";
}

/** 是否可任命/撤职社管（仅社长）。 */
export function canManageRoles(role: CoopRole | null | undefined): boolean {
  return role === "owner";
}

/** 踢人目标是否合法（不可踢社长；社管不可踢社管）。 */
export function canKickTarget(actorRole: CoopRole, targetRole: CoopRole): boolean {
  if (!canKick(actorRole)) return false;
  if (targetRole === "owner") return false;
  if (actorRole === "admin" && targetRole === "admin") return false;
  return true;
}

/** 角色显示名。 */
export function roleLabel(role: CoopRole): string {
  switch (role) {
    case "owner":
      return "社长";
    case "admin":
      return "管理员";
    default:
      return "成员";
  }
}
