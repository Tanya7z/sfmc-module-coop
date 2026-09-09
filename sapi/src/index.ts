/**
 * @sfmc-bds/module-coop — 合作社公账与组织治理
 */

import type { Player } from "@minecraft/server";
import { ModuleRegistry } from "@sfmc-bds/sdk/module-loader";
import { Command, debug, Msg, Permission } from "@sfmc-bds/sdk/sapi/runtime";
import { service } from "@sfmc-bds/sdk/sapi/service";
import { serviceById, serviceByPlayer, serviceList } from "./ops.js";
import { openCoopPanel, showCoopHelp } from "./panel.js";
import { defineCoopTables } from "./store.js";

export const MODULE_ID = "coop";

const unprovide: Array<() => void> = [];

async function tryRegisterGuiMenu(): Promise<void> {
  try {
    await service.call("gui.registerMenuItem", {
      id: "coop.panel",
      title: "合作社",
      order: 35,
      category: "general",
      permission: "coop.use",
      handler: (player: Player) => {
        void openCoopPanel(player).catch((err) => {
          debug.w("COOP", `panel: ${err instanceof Error ? err.message : String(err)}`);
          showCoopHelp(player);
        });
      },
    } as unknown as Record<string, unknown>);
    debug.i("COOP", "gui menu registered");
  } catch (err) {
    debug.w("COOP", `gui.registerMenuItem 不可用，已降级: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function registerCommands(): void {
  Command.register(
    "coop",
    "coop.use",
    (player) => {
      if (!player) {
        debug.i("COOP", "该指令必须由玩家执行");
        return;
      }
      void openCoopPanel(player).catch((err) => {
        debug.w("COOP", `open panel: ${err instanceof Error ? err.message : String(err)}`);
        Msg.error("无法打开合作社面板，已显示文字指引。", player);
        showCoopHelp(player);
      });
    },
    "打开合作社面板（建社/入退/金库/排行）",
    MODULE_ID
  );
}

registerCommands();

ModuleRegistry.register({
  id: MODULE_ID,
  afterWorldLoad: false,
  lifecycle: {
    registerPermissions() {
      Permission.register("coop.use", Permission.Member);
      // 设计写「Admin（等级 2）」→ SDK 中 OP=2
      Permission.register("coop.admin", Permission.OP);
    },
    registerEvents() {
      // 本模块无世界事件订阅
    },
    async init() {
      await defineCoopTables();

      unprovide.push(service.provide("coop.byId", (input) => serviceById(input)));
      unprovide.push(service.provide("coop.list", (input) => serviceList(input)));
      unprovide.push(service.provide("coop.byPlayer", (input) => serviceByPlayer(input)));

      await tryRegisterGuiMenu();
      debug.i("COOP", "init ready");
    },
    cleanup() {
      for (const off of unprovide.splice(0, unprovide.length)) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      debug.i("COOP", "cleanup");
    },
  },
});
