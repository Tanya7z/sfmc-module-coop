# @sfmc-bds/module-coop

Wave C official SFMC module: **coop**（合作社公账与组织治理）。

- 公账账户：`coop:<cid>`，经 `economy.account.transfer` 划转（无私有钱包表）
- 治理审计：`activity.record`（`eventType: "coop.audit"`）
- 面板：`!coop` + `gui.registerMenuItem`

## Develop

```bash
npm install
npm run typecheck
npm test
```

Install into platform:

```bash
sfmc mod install coop --from dir:. --link
```
