/**
 * @sfmc-bds/module-coop — 合作社公账与组织治理
 */

import { ModuleRegistry } from "@sfmc-bds/sdk/module-loader";
import { Command, debug, Permission } from "@sfmc-bds/sdk/sapi/runtime";
import { service } from "@sfmc-bds/sdk/sapi/service";
import { ui } from "@sfmc-bds/sdk/sapi/ui";
import { serviceById, serviceByPlayer, serviceList } from "./ops.js";
import { defineCoopTables } from "./store.js";
import { coopUiServices } from "./ui-services.js";
import featureUi from "./ui/feature.ui.json" with { type: "json" };
import bankUi from "./ui/screens/bank.ui.json" with { type: "json" };
import createUi from "./ui/screens/create.ui.json" with { type: "json" };
import homeUi from "./ui/screens/home.ui.json" with { type: "json" };
import joinUi from "./ui/screens/join.ui.json" with { type: "json" };
import membersUi from "./ui/screens/members.ui.json" with { type: "json" };
import rankUi from "./ui/screens/rank.ui.json" with { type: "json" };

export const MODULE_ID = "coop";

const unprovide: Array<() => void> = [];
let unregisterUi: (() => void) | undefined;

function registerUiFeature(): void {
  unregisterUi?.();
  unregisterUi = ui.registerFeature({
    feature: featureUi,
    screens: {
      "screens/home.ui.json": homeUi,
      "screens/create.ui.json": createUi,
      "screens/join.ui.json": joinUi,
      "screens/bank.ui.json": bankUi,
      "screens/rank.ui.json": rankUi,
      "screens/members.ui.json": membersUi,
    },
  });
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
      void ui
        .openScreen(player, {
          moduleId: MODULE_ID,
          screenId: "coop.home",
        })
        .catch((error) => {
          debug.w("COOP", `open ui: ${error instanceof Error ? error.message : String(error)}`);
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
      for (const [name, handler] of Object.entries(coopUiServices)) {
        unprovide.push(service.provide(name, handler));
      }

      registerUiFeature();
      debug.i("COOP", "init ready");
    },
    cleanup() {
      unregisterUi?.();
      unregisterUi = undefined;
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
