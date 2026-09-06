/**
 * coop 纯逻辑与清单一致性测试（不依赖 Minecraft 运行时）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canDissolve,
  canKick,
  canKickTarget,
  canTransfer,
  canWithdraw,
  coopAccountId,
  memberRowId,
  newCid,
  validateAmount,
  validateCoopName,
} from "../sapi/src/rules.ts";

const MANIFEST_PATH = fileURLToPath(new URL("../sapi/manifest.json", import.meta.url));

describe("coop rules", () => {
  it("公账账户标识为 coop:<cid>", () => {
    assert.equal(coopAccountId("c_abc"), "coop:c_abc");
  });

  it("成员主键合成", () => {
    assert.equal(memberRowId("c1", "p1"), "c1:p1");
  });

  it("newCid 可生成非空短 id", () => {
    const id = newCid(1_700_000_000_000, 0.42);
    assert.match(id, /^c_[a-z0-9]+_[a-z0-9]+$/);
  });

  it("社名校验", () => {
    assert.equal(validateCoopName(""), "社名不能为空");
    assert.equal(validateCoopName("a:b"), "社名不能包含冒号");
    assert.equal(validateCoopName("x".repeat(25)), "社名最长 24 字");
    assert.equal(validateCoopName("  红石社  "), null);
  });

  it("金额须为正整数", () => {
    assert.equal(validateAmount(10), 10);
    assert.equal(validateAmount(0), "金额须为正整数");
    assert.equal(validateAmount(1.5), "金额须为正整数");
  });

  it("提现门禁：仅 owner/admin", () => {
    assert.equal(canWithdraw("owner"), true);
    assert.equal(canWithdraw("admin"), true);
    assert.equal(canWithdraw("member"), false);
    assert.equal(canWithdraw(null), false);
  });

  it("踢人/转让/解散门禁", () => {
    assert.equal(canKick("admin"), true);
    assert.equal(canKick("member"), false);
    assert.equal(canTransfer("owner"), true);
    assert.equal(canTransfer("admin"), false);
    assert.equal(canDissolve("owner"), true);
    assert.equal(canDissolve("admin"), false);
  });

  it("踢人目标约束", () => {
    assert.equal(canKickTarget("owner", "member"), true);
    assert.equal(canKickTarget("owner", "admin"), true);
    assert.equal(canKickTarget("owner", "owner"), false);
    assert.equal(canKickTarget("admin", "admin"), false);
    assert.equal(canKickTarget("member", "member"), false);
  });
});

describe("coop manifest", () => {
  it("短名 / requires / provides / 表权限对齐规格", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      schemaVersion: number;
      id: string;
      configKey: string;
      requires: string[];
      permissions: string[];
      services: {
        provides: Array<{ name: string }>;
        requires: Array<{ name: string }>;
      };
    };

    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.id, "coop");
    assert.equal(manifest.configKey, "coop");
    assert.deepEqual(manifest.requires, ["economy", "activity-log"]);

    const provides = manifest.services.provides.map((p) => p.name).sort();
    assert.deepEqual(provides, ["coop.byId", "coop.byPlayer", "coop.list"].sort());

    const reqSvc = manifest.services.requires.map((r) => r.name).sort();
    assert.deepEqual(
      reqSvc,
      ["activity.record", "economy.account.get", "economy.account.transfer"].sort(),
    );

    for (const p of [
      "db:read:sfmc_coops",
      "db:write:sfmc_coops",
      "db:read:sfmc_coop_members",
      "db:write:sfmc_coop_members",
      "service:gui.registerMenuItem",
    ]) {
      assert.ok(manifest.permissions.includes(p), `缺少权限 ${p}`);
    }

    // 严禁自建钱包/审计表权限位
    assert.ok(!manifest.permissions.some((x) => /wallet|ledger|audit_log|bank_balance/i.test(x)));
  });
});
