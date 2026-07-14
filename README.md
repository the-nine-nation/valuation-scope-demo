# 估值刻度 Demo

A 股观察池：五档估值刻度对照现价。公网页部署 Cloudflare Workers；管理页仅本机。

## 目录结构

```text
.
├── apps/
│   ├── web/                 # Cloudflare 公网页（vinext / Workers）
│   └── admin/               # 本地管理页（127.0.0.1 only，不部署）
├── data/                    # 共享数据（web + admin 都读写这里）
│   ├── stocks.source.json   # 分析权威源（无现价）
│   ├── prices.snapshot.json # 现价快照
│   ├── stocks.db            # seed 生成，不进 Git
│   └── anysis/              # 价值投资分析 skill（本地）
├── tools/
│   ├── scripts/             # seed / 日更价 / 端口
│   └── tests/
├── docs/                    # 说明与研究笔记
├── package.json             # monorepo 根脚本
├── 启动页面.command         # 公网页 localhost:5566
└── 启动管理.command         # 管理页 127.0.0.1:5567
```

| 应用 | 代码 | 数据 | 是否上线 |
|------|------|------|----------|
| 公网页 | `apps/web` | 读 seed 后的 `apps/web/app/data/stocks.generated.json`（由 `data/*` 生成） | ✅ Workers |
| 管理页 | `apps/admin` | 直接读写 `data/stocks.source.json` + `data/prices.snapshot.json` | ❌ 仅本机 |

## 线上地址

https://valuation-scope-demo.valuation-scope.workers.dev

## 常用命令（在仓库根目录）

```bash
npm install
npm run dev          # 公网页预览 :5566
npm run admin        # 本地管理 :5567（增删 / 设置 Codex 模型 / 触发分析）
npm run prices:update
npm run db:seed
npm run deploy       # seed 后部署公网页
npm test
```

## 共享数据约定

| 文件 | 谁改 | Git |
|------|------|-----|
| `data/stocks.source.json` | 人 / 管理页 / 分析 | 提交 |
| `data/prices.snapshot.json` | `prices:update` / Actions | 提交 |
| `apps/web/app/data/stocks.generated.json` | 仅 `db:seed` | **不提交** |
| `data/stocks.db` | 仅 seed | **不提交** |
| `data/admin.settings.json` | 管理页 | **不提交** |

规则：自动化只更新价格；分析与名单只改 source；部署前必须 seed。

## 价格双轨与部署

| 层 | 作用 | 刷新 |
|---|---|---|
| **展示实时** | 公网页 `/api/quotes`、管理页 `/api/quotes` 直连腾讯行情 | 打开页面后约 30s 轮询 |
| **Git 快照** | `data/prices.snapshot.json`（seed 兜底 / 离线） | CI 交易时段约每 30 分钟 |

工作流：`.github/workflows/daily-prices.yml`

1. 工作日交易时段 cron（约每 30 分钟，UTC）→ 更新 `prices.snapshot.json` → commit  
2. push `main` 或价格任务成功后 → seed → deploy `apps/web`  
3. 线上页面现价以 Worker 实时接口为主，快照仅作兜底  

Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。

## 管理页说明

- 绑定 **`127.0.0.1:5567`**，不会随 `npm run deploy` 上线  
- 可设置 Codex 分析模型（`codex exec -m <model>`）  
- **新增股票只填 6 位代码** → 自动查名称/行业 → 确认后入池（草稿）→ 再点「AI 分析」  
- 「AI 分析」流水线：  
  1. Codex 按 skill 写 `data/anysis/runs/<代码>.json`  
  2. `node tools/scripts/ingest-analysis.mjs` 校验并**只合并该股票**价值投资字段到 `stocks.source.json`  
  3. `db:seed`  
  4. `push-source`：**只** commit/push `data/stocks.source.json`  

```bash
npm run lookup -- 600519
npm run analysis:ingest -- 600519
npm run analysis:push -- --message "analysis: update 600519"
```
