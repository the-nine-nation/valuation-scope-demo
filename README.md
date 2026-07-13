# 估值刻度 Demo

在 macOS 上可直接双击项目根目录的 `启动页面.command` 启动页面；首次运行会自动安装所需组件，并在浏览器中打开本地页面。

也可以在终端运行：

```bash
npm run dev
```

## 线上地址

https://valuation-scope-demo.valuation-scope.workers.dev

## 常用命令

```bash
npm run prices:update   # 拉取 A 股现价并重写快照
npm run deploy          # 构建并部署到 Cloudflare Workers
npm run db:seed         # 仅从 data/stocks.source.json 重建快照
```

## 日更自动化

GitHub Actions 工作流：`.github/workflows/daily-prices.yml`

- 每个工作日北京时间约 16:10 自动更新现价
- 有变更则提交 `data/stocks.source.json` 与 `app/data/stocks.generated.json`
- 若配置了 Secrets，则继续部署到 Cloudflare

需要在仓库 Settings → Secrets 中配置：

- `CLOUDFLARE_API_TOKEN`：用模板 **Edit Cloudflare Workers** 创建  
  - **不要**开启 Client IP Address Filtering（GitHub Actions 在海外 IP，会报 9109）  
  - Account 选你的 Cloudflare 账号
- `CLOUDFLARE_ACCOUNT_ID`：`7b38ee994385e861ee8e0e7feb58e9b0`

日更提交与部署是两个独立 job：即使自动部署失败，现价仍会写回仓库。  
本地部署始终可用：`npm run deploy`（依赖本机 `wrangler login`）。
