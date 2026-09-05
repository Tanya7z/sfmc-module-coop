/**
 * 合作社交互面板：MenuNavigator 轻量指引（非独立全屏 GUI）。
 */

import type { Player } from "@minecraft/server";
import {
  FormStatus,
  ListFormInfo,
  MenuNavigator,
  Msg,
  obsNum,
  obsStr,
  type Page,
} from "@sfmc-bds/sdk/sapi/runtime";
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
} from "./ops.js";
import { roleLabel, type CoopRole } from "./rules.js";

function actorOf(player: Player) {
  return { playerId: player.id, playerName: player.name };
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return err instanceof Error ? err.message : String(err);
}

/** 文本帮助（命令面回落）。 */
export function showCoopHelp(player: Player): void {
  Msg.info(
    ListFormInfo([
      "合作社指令指引（也可从主菜单进入）",
      "打开面板：!coop",
      "在面板内完成：建社 / 入社 / 退社 / 金库 / 排行 / 转让 / 踢人",
      "公账由 economy 托管，账户形如 coop:<cid>",
    ]),
    player,
  );
}

/** 打开合作社面板。 */
export async function openCoopPanel(player: Player): Promise<void> {
  const nav = new MenuNavigator(player);
  const nameField = obsStr("");
  const joinKey = obsStr("");
  const amountField = obsNum(1);
  const targetName = obsStr("");

  nav.section("root", "合作社", async (page) => {
    new FormStatus(page);
    page.header("合作社");
    const membership = await findMembership(player.id);
    if (membership) {
      const coop = await getCoop(membership.cid);
      let bal = 0;
      try {
        bal = await getBankBalance(membership.cid);
      } catch {
        bal = 0;
      }
      page.label(
        obsStr(
          `当前：§e${coop?.name ?? membership.cid}§r\n` +
            `职务：§a${roleLabel(membership.role as CoopRole)}§r\n` +
            `公账：§6${bal}§r（${`coop:${membership.cid}`}）`,
        ),
      );
    } else {
      page.label(obsStr("你尚未加入任何合作社。"));
    }
    page.divider();
    page.button("创建合作社", () => {
      nav.go("create");
      void nav.rebuild();
    });
    page.button("加入合作社", () => {
      nav.go("join");
      void nav.rebuild();
    });
    page.button("退出合作社", () => {
      void nav.runTask(new FormStatus(page), async () => {
        await leaveCoop(actorOf(player));
        Msg.success("已退出合作社", player);
        await nav.replace("root");
      });
    });
    page.button("金库存取", () => {
      nav.go("bank");
      void nav.rebuild();
    });
    page.button("活跃排行", () => {
      nav.go("rank");
      void nav.rebuild();
    });
    page.button("转让社长", () => {
      nav.go("transfer");
      void nav.rebuild();
    });
    page.button("踢出成员", () => {
      nav.go("kick");
      void nav.rebuild();
    });
    page.button("解散合作社", () => {
      void (async () => {
        const ok = await nav.confirmMessage("解散合作社", "确认解散？成员将全部移除，公账余额不会自动清零。");
        if (!ok) return;
        try {
          await dissolveCoop(actorOf(player));
          Msg.success("合作社已解散", player);
          await nav.replace("root");
        } catch (e) {
          Msg.error(errMsg(e), player);
        }
      })();
    });
  });

  nav.section("create", "创建合作社", (page: Page) => {
    const status = new FormStatus(page);
    page.header("创建合作社");
    page.textField("社名", nameField);
    page.button("确认创建", () => {
      void nav.runTask(status, async () => {
        const { cid, name } = await createCoop(actorOf(player), nameField.getData());
        Msg.success(`已创建合作社 §e${name}§r（${cid}）`, player);
        await nav.replace("root");
      });
    });
  });

  nav.section("join", "加入合作社", (page: Page) => {
    const status = new FormStatus(page);
    page.header("加入合作社");
    page.textField("合作社 ID 或社名", joinKey);
    page.button("确认加入", () => {
      void nav.runTask(status, async () => {
        const { name } = await joinCoop(actorOf(player), joinKey.getData());
        Msg.success(`已加入 §e${name}`, player);
        await nav.replace("root");
      });
    });
  });

  nav.section("bank", "金库", async (page: Page) => {
    const status = new FormStatus(page);
    page.header("金库存取");
    const membership = await findMembership(player.id);
    if (!membership) {
      page.label(obsStr("你不在合作社中。"));
      return;
    }
    let bal = 0;
    try {
      bal = await getBankBalance(membership.cid);
    } catch {
      bal = 0;
    }
    page.label(obsStr(`公账余额：§6${bal}§r\n成员可存款；提现需社长/管理员。`));
    page.slider("金额", amountField, 1, 100000);
    page.button("存入公账", () => {
      void nav.runTask(status, async () => {
        await depositBank(actorOf(player), Math.floor(amountField.getData()));
        Msg.success("存款成功", player);
        await nav.replace("bank");
      });
    });
    page.button("提现到个人", () => {
      void nav.runTask(status, async () => {
        await withdrawBank(actorOf(player), Math.floor(amountField.getData()));
        Msg.success("提现成功", player);
        await nav.replace("bank");
      });
    });
  });

  nav.section("rank", "排行榜", async (page: Page) => {
    page.header("合作社活跃排行");
    const rows = await rankCoops(10);
    if (!rows.length) {
      page.label(obsStr("暂无合作社。"));
      return;
    }
    page.label(
      obsStr(
        rows
          .map((r) => `#${r.rank} §e${r.name}§r 成员${r.memberCount} 公账${r.bankBalance}`)
          .join("\n"),
      ),
    );
  });

  nav.section("transfer", "转让社长", async (page: Page) => {
    const status = new FormStatus(page);
    page.header("转让社长");
    const membership = await findMembership(player.id);
    if (!membership) {
      page.label(obsStr("你不在合作社中。"));
      return;
    }
    const members = await listMembers(membership.cid);
    page.label(obsStr("选择新社长（须为本社成员）："));
    for (const m of members) {
      if (m.player_id === player.id) continue;
      page.button(`${m.player_name}（${roleLabel(m.role as CoopRole)}）`, () => {
        void nav.runTask(status, async () => {
          await transferOwner(actorOf(player), m.player_id);
          Msg.success(`已转让社长给 §e${m.player_name}`, player);
          await nav.replace("root");
        });
      });
    }
  });

  nav.section("kick", "踢出成员", async (page: Page) => {
    const status = new FormStatus(page);
    page.header("踢出成员");
    const membership = await findMembership(player.id);
    if (!membership) {
      page.label(obsStr("你不在合作社中。"));
      return;
    }
    const members = await listMembers(membership.cid);
    for (const m of members) {
      if (m.player_id === player.id) continue;
      page.button(`踢出 ${m.player_name}`, () => {
        void nav.runTask(status, async () => {
          await kickMember(actorOf(player), m.player_id);
          Msg.success(`已踢出 §e${m.player_name}`, player);
          await nav.replace("kick");
        });
      });
    }
    // 保留文本入口兼容离线名（在线匹配）
    page.divider();
    page.textField("或输入在线玩家名", targetName);
    page.button("按名称踢出", () => {
      void nav.runTask(status, async () => {
        const name = targetName.getData().trim().toLowerCase();
        const hit = members.find((m) => m.player_name.toLowerCase() === name);
        if (!hit) throw new Error("未找到该成员");
        await kickMember(actorOf(player), hit.player_id);
        Msg.success(`已踢出 §e${hit.player_name}`, player);
        await nav.replace("kick");
      });
    });
  });

  await nav.start("root");
}
