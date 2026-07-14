---
name: charlie-munger-value-investing
description: >-
  查理·芒格风格的上市公司基本面与估值分析（A股/美股/港股），尤其适合消费品、品牌、美妆、鞋服、
  食品饮料、零售。用户要求分析股票、估值、好公司好价格、三情景估值、分层买入区间、
  查理芒格/价值投资/基本面分析/估值分析时使用。不用于技术面短线交易。最终报告用中文输出。
---

# 查理·芒格价值投资分析

研究框架，**不构成**投资建议、买卖建议或收益承诺。  
**最终交付物一律使用中文**（表格表头、结论、风险、区间说明均中文）。

## 芒格立场（必守）

1. **能力圈** — 看不懂就不硬分析。
2. **质量优先** — 烂公司低 PE 常是价值陷阱。
3. **护城河** — 品牌、定价权、单位经济、可持续 ROE/现金流。
4. **安全边际** — 在保守内在价值之下买。
5. **反过来想** — 买入前先写否决条件。
6. **耐心** — 分层区间，不要单一目标价。

心智模型细节 → `references/mental-models.md`（分析前建议通读关键清单）。

## 四个核心问题

| # | 问题 | 看什么 |
|---|------|--------|
| 1 | 是不是好公司？ | 模式、品牌、ROE、现金流、竞争 |
| 2 | 是不是好阶段？ | 高成长 / 成熟 / 换挡 / 困境修复 / 衰退 |
| 3 | 估值是否便宜？ | PE/PB/PS、历史分位、同业 |
| 4 | 什么价格更舒服？ | 情景 × 合理倍数 → 分层买入区 |

## 执行流程

按序执行；**仅在需要时**加载对应 reference，避免一次塞满上下文。

| 步骤 | 动作 | 按需加载 |
|------|------|----------|
| 0 | 确认标的、市场、数据日期；能力圈外则拒绝或降置信 | `references/mental-models.md` |
| 1 | 收集行情 + 财务 + 业务结构 | `references/data-checklist.md` |
| 2 | 选定行业估值框架 | `references/valuation-framework.md` |
| 3 | 质量评分 + 生命周期 | `references/analysis-workflow.md` 步骤 2–3 |
| 4 | 财报质量（利润表/现金流/资产负债表） | `references/analysis-workflow.md` 步骤 4 |
| 5 | 历史估值 + 同业（含海外定锚） | `references/analysis-workflow.md` 步骤 5–6 |
| 6 | 悲观 / 中性 / 乐观三情景 | `references/valuation-framework.md` |
| 7 | 分层买入区 + 分档建仓 | `references/valuation-framework.md` |
| 8 | 提高买入价条件；否决与风险触发 | `references/analysis-workflow.md` 步骤 9–10 |
| 9 | 按模板写**中文**报告 | `references/report-template.md` |
| 10 | 原则 + 15 问自检 | `references/principles-checklist.md` |

## 中文输出硬性要求

报告**必须**用中文写，并包含：

- 公司基本面结论  
- 财报质量判断  
- 历史估值位置  
- 同业对比  
- 悲观 / 中性 / 乐观三种情景  
- 分层买入区间（禁止只给一个点位）  
- 提高买入价的条件  
- 不买 / 减仓 / 放弃的风险触发条件  
- 一句话总结：好公司？好价格？舒服买入区间？

文风：

- 先结论，再依据  
- 关键数字用表格  
- 明确区分 **事实 / 假设 / 判断**  
- 禁止「必涨」「稳赚」「抄底」等绝对化表达  
- 优缺点与风险并陈  
- 数据注明**来源与日期**

## 快捷提示词

```text
请按 charlie-munger-value-investing skill 用中文分析【名称 + 代码】。
要求：最新估值与 3–5 年财报；质量与阶段；同业+海外可比；悲观/中性/乐观三情景；
分层买入区间；提高买入价条件；否决与风险触发；一句话结论。
结论须谨慎，不构成投资建议；数据注明来源与日期。
```

完整分析师指令 → `references/principles-checklist.md`。

## 参考文件索引

| 文件 | 内容 |
|------|------|
| `references/mental-models.md` | 芒格心智模型、误判心理、能力圈清单 |
| `references/data-checklist.md` | 必采行情 / 财务 / 业务字段 |
| `references/analysis-workflow.md` | 质量、阶段、三表、历史、同业、否决 |
| `references/valuation-framework.md` | 行业 PE、公式、三情景、买入区、建仓 |
| `references/report-template.md` | 中文报告骨架（最终输出按此） |
| `references/principles-checklist.md` | 10 原则、15 问、完整 AI 指令 |

## 硬规则

- 没有「质量 + 阶段 + 估值 + 否决条件」不得给出买卖倾向。  
- 禁止只看 PE；必须结合现金流、ROE、历史、同业。  
- 盈利中枢永久下移时，禁止机械套用历史高 PE。  
- 海外估值只作定锚，禁止照搬。  
- 数据缺失须写明缺口，并加大安全边际或中止结论。  
- **最终报告语言：中文。**

## 入库交付（管理页 / Codex 分析必做）

本仓库的公网页只读 `data/stocks.source.json` 经 seed 后的字段。  
**仅写 Markdown 报告不够**——必须产出可校验的 JSON，再由确定性脚本入库。

### 1. 写 run 文件（Codex 负责）

路径（固定）：

```text
data/anysis/runs/<symbol>.json
```

例如 `600519` → `data/anysis/runs/600519.json`。

**禁止**直接手改 `data/stocks.source.json` 中其他股票；只写本 symbol 的 run 文件。  
**禁止**写入 `currentPrice` / `asOf` / `valuation`（现价在 `prices.snapshot.json`）。  
**禁止** `git commit` / `git push`（由管理页脚本 `tools/scripts/push-source.mjs` 只推 source）。

### 2. JSON 合同（必须通过校验）

完整 schema 见 `tools/scripts/analysis-schema.mjs`（`ANALYSIS_RUN_CONTRACT`）。最小形状：

```json
{
  "symbol": "600519",
  "quality": "A",
  "idealPrice": "¥1200–1300",
  "valuationAnchor": "2026E PE xx×",
  "thesis": "2–4 句卡片摘要…",
  "keyRisk": "关键否决风险…",
  "bands": [
    ["深度低估", "¥xx 以下", null, 0, "…"],
    ["舒适买入", "¥xx–yy", 0, 0, "…"],
    ["合理偏低", "¥xx–yy", 0, 0, "…"],
    ["合理区", "¥xx–yy", 0, 0, "…"],
    ["偏贵区", "¥xx 以上", 0, null, "…"]
  ],
  "analysis": {
    "summary": "一句话结论",
    "stage": "成熟稳定",
    "circleOfCompetence": "在圈内",
    "priceVerdict": "合理",
    "business": "业务与护城河段落…",
    "financials": "财报质量段落…",
    "valuation": "估值位置段落…",
    "peers": "同业定锚段落…",
    "scenarios": [
      { "name": "悲观", "assumption": "…", "fairValue": "¥…" },
      { "name": "中性", "assumption": "…", "fairValue": "¥…" },
      { "name": "乐观", "assumption": "…", "fairValue": "¥…" }
    ],
    "raiseBuyPriceWhen": ["…"],
    "vetoTriggers": ["…"],
    "reportMarkdown": "可选完整中文报告",
    "analyzedAt": "YYYY-MM-DD"
  }
}
```

硬约束：

- `bands` **正好 5 档**；`lower`/`upper` 为 number 或 `null`；相邻区间合理。  
- `analysis.business` / `financials` / `valuation` 各 ≥ 20 字（详情页展示用）。  
- `analysis.scenarios` ≥ 3 条。  
- 全文中文。  
- **审计字段（ingest 硬校验，缺一不可）**  
  - `analysis.skillVersion`：固定 `charlie-munger-value-investing@1`  
  - `analysis.stepsCompleted`：必须包含全部  
    `0-scope-circle` … `10-principles-selfcheck`（见 `tools/scripts/analysis-schema.mjs` 的 `REQUIRED_SKILL_STEPS`）  
  - `analysis.sources`：≥ 2 条；每条 `{ title, url?, asOf?, kind? }`  
    - `kind` 建议：`filing` | `quote` | `peer` | `news` | `other`  
  - 研究可用内置 web_search / 只读拉公开财报；用户 MCP 在管理页 headless 中关闭  

### 3. 确定性入库（脚本负责，不要跳过）

```bash
node tools/scripts/ingest-analysis.mjs <symbol>
# 校验 run JSON → 只合并该 symbol 的价值投资字段到 data/stocks.source.json
```

管理页「重新分析」会：`codex exec` → `ingest-analysis` → `db:seed` → `push-source`（仅 source 文件）。
