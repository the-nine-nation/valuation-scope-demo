# 估值刻度 Demo

在 macOS 上可直接双击项目根目录的 `启动页面.command` 启动页面；首次运行会自动安装所需组件，并在浏览器中打开本地页面。

也可以在终端运行：

```bash
npm run dev
```

## 线上地址

https://valuation-scope-demo.valuation-scope.workers.dev

## 数据怎么分（重要）

| 文件 | 谁改 | 内容 |
|------|------|------|
| `data/stocks.source.json` | 人 / 半自动校准 | 名单、质量、论点、风险、**估值 bands**（**不含现价**） |
| `data/prices.snapshot.json` | 仅 `prices:update` / GitHub Actions | 现价 + 日期 |
| `app/data/stocks.generated.json` | 仅 `db:seed` 生成 | 合并后的展示快照（**不进 Git**） |
| `data/stocks.db` | 仅 `db:seed` 生成 | 本地 SQLite（**不进 Git**） |

规则：

- 自动化**只**更新 `prices.snapshot.json`
- 分析 / 增删股票**只**改 `stocks.source.json`
- 构建 / 部署前必须 `db:seed`（`prebuild` / `predeploy` / `predev` 已挂上）

## 常用命令

```bash
npm run prices:update   # 拉 A 股现价 → 只写 prices.snapshot.json → seed
npm run db:seed         # source + prices → db + generated（本地/CI）
npm run deploy          # seed 后构建并部署到 Cloudflare Workers
npm run dev             # seed 后本地预览
```

## 日更与部署自动化

工作流：`.github/workflows/daily-prices.yml`

触发：

1. **定时**：每个工作日北京时间约 16:10 → 更新价格 → 只 commit `data/prices.snapshot.json` → seed → deploy  
2. **手动**：GitHub Actions → Run workflow  
3. **push 到 `main`**：跳过拉价，直接 seed + deploy（分析变更合并后自动上页）

需要在仓库 Settings → Secrets 中配置：

- `CLOUDFLARE_API_TOKEN`：用模板 **Edit Cloudflare Workers** 创建  
  - **不要**开启 Client IP Address Filtering（GitHub Actions 在海外 IP，会报 9109）  
  - Account 选你的 Cloudflare 账号
- `CLOUDFLARE_ACCOUNT_ID`：`7b38ee994385e861ee8e0e7feb58e9b0`

日更提交与部署是两个独立 job：即使自动部署失败，现价仍会写回仓库。  
本地部署始终可用：`npm run deploy`（依赖本机 `wrangler login`）。
