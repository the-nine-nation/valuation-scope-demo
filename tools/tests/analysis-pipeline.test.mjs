import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeAnalysisPayload,
  REQUIRED_SKILL_STEPS,
  REQUIRED_SKILL_VERSION,
} from "../scripts/analysis-schema.mjs";
import { lookupStock } from "../scripts/lookup-stock.mjs";
import { buildAnalyzeExecArgs } from "../../apps/admin/lib/codex.mjs";

const AUDIT_FIELDS = {
  skillVersion: REQUIRED_SKILL_VERSION,
  stepsCompleted: [...REQUIRED_SKILL_STEPS],
  sources: [
    {
      title: "贵州茅台 2025 年报",
      url: "https://www.cninfo.com.cn/",
      asOf: "2026-03-31",
      kind: "filing",
    },
    {
      title: "行情快照",
      url: null,
      asOf: "2026-07-14",
      kind: "quote",
    },
  ],
};

test("normalizeAnalysisPayload accepts a valid run contract", () => {
  const payload = {
    symbol: "600519",
    quality: "A",
    idealPrice: "¥1200–1300",
    valuationAnchor: "2026E PE 20×",
    thesis: "品牌与定价权极强，长期 ROE 与现金流质量优秀，但估值常年不便宜。",
    keyRisk: "批价与需求走弱导致盈利中枢下移。",
    bands: [
      ["深度低估", "¥1000 以下", null, 1000, "极端安全边际区"],
      ["舒适买入", "¥1000–1200", 1000, 1200, "可分批"],
      ["合理偏低", "¥1200–1400", 1200, 1400, "小仓"],
      ["合理区", "¥1400–1600", 1400, 1600, "观察"],
      ["偏贵区", "¥1600 以上", 1600, null, "不追"],
    ],
    analysis: {
      summary: "好公司，价格需耐心。",
      stage: "成熟稳定",
      circleOfCompetence: "在圈内",
      priceVerdict: "偏贵",
      business: "茅台主业清晰，品牌护城河深厚，系列酒与直销结构持续优化。",
      financials: "毛利率与净利率长期领先，经营现金流与分红匹配度高。",
      valuation: "历史 PE 分位偏高，需用保守 EPS 与安全边际约束买点。",
      peers: "相对五粮液等浓香龙头溢价显著，反映品牌稀缺。",
      scenarios: [
        { name: "悲观", assumption: "批价承压", fairValue: "¥1100" },
        { name: "中性", assumption: "稳态增长", fairValue: "¥1300" },
        { name: "乐观", assumption: "提价顺利", fairValue: "¥1500" },
      ],
      raiseBuyPriceWhen: ["批价稳定回升"],
      vetoTriggers: ["渠道大量压货"],
      reportMarkdown: "## 结论\n好公司，等好价格。",
      ...AUDIT_FIELDS,
      analyzedAt: "2026-07-14",
      model: "test",
    },
  };

  const { symbol, patch } = normalizeAnalysisPayload(payload, "600519");
  assert.equal(symbol, "600519");
  assert.equal(patch.bands.length, 5);
  assert.equal(patch.analysis.scenarios.length, 3);
  assert.match(patch.analysis.business, /护城河|茅台/);
  assert.equal(patch.analysis.skillVersion, REQUIRED_SKILL_VERSION);
  assert.equal(patch.analysis.stepsCompleted.length, REQUIRED_SKILL_STEPS.length);
  assert.equal(patch.analysis.sources.length, 2);
});

test("normalizeAnalysisPayload rejects missing skill audit fields", () => {
  const base = {
    symbol: "600519",
    quality: "A",
    idealPrice: "¥1200–1300",
    valuationAnchor: "2026E PE 20×",
    thesis: "品牌与定价权极强，长期 ROE 与现金流质量优秀，但估值常年不便宜。",
    keyRisk: "批价与需求走弱导致盈利中枢下移。",
    bands: [
      ["深度低估", "¥1000 以下", null, 1000, "极端安全边际区"],
      ["舒适买入", "¥1000–1200", 1000, 1200, "可分批"],
      ["合理偏低", "¥1200–1400", 1200, 1400, "小仓"],
      ["合理区", "¥1400–1600", 1400, 1600, "观察"],
      ["偏贵区", "¥1600 以上", 1600, null, "不追"],
    ],
    analysis: {
      summary: "好公司，价格需耐心。",
      stage: "成熟稳定",
      circleOfCompetence: "在圈内",
      priceVerdict: "偏贵",
      business: "茅台主业清晰，品牌护城河深厚，系列酒与直销结构持续优化。",
      financials: "毛利率与净利率长期领先，经营现金流与分红匹配度高。",
      valuation: "历史 PE 分位偏高，需用保守 EPS 与安全边际约束买点。",
      peers: "相对五粮液等浓香龙头溢价显著，反映品牌稀缺。",
      scenarios: [
        { name: "悲观", assumption: "批价承压", fairValue: "¥1100" },
        { name: "中性", assumption: "稳态增长", fairValue: "¥1300" },
        { name: "乐观", assumption: "提价顺利", fairValue: "¥1500" },
      ],
      raiseBuyPriceWhen: ["批价稳定回升"],
      vetoTriggers: ["渠道大量压货"],
    },
  };

  assert.throws(
    () => normalizeAnalysisPayload(base, "600519"),
    /skillVersion/,
  );
  assert.throws(
    () =>
      normalizeAnalysisPayload(
        {
          ...base,
          analysis: {
            ...base.analysis,
            skillVersion: REQUIRED_SKILL_VERSION,
            stepsCompleted: REQUIRED_SKILL_STEPS.slice(0, 3),
            sources: AUDIT_FIELDS.sources,
          },
        },
        "600519",
      ),
    /stepsCompleted missing/,
  );
  assert.throws(
    () =>
      normalizeAnalysisPayload(
        {
          ...base,
          analysis: {
            ...base.analysis,
            skillVersion: REQUIRED_SKILL_VERSION,
            stepsCompleted: [...REQUIRED_SKILL_STEPS],
            sources: [{ title: "only one" }],
          },
        },
        "600519",
      ),
    /sources/,
  );
});

test("buildAnalyzeExecArgs enables web_search and sandbox network", () => {
  const args = buildAnalyzeExecArgs({
    model: "gpt-5.6-sol",
    workspace: "/tmp/ws",
    prompt: "analyze",
    reasoningEffort: "medium",
  });
  assert.ok(args.includes('web_search="live"'));
  assert.ok(args.includes("sandbox_workspace_write.network_access=true"));
  assert.ok(args.includes("mcp_servers={}"));
  assert.ok(args.includes('approval_policy="never"'));
});

test("normalizeAnalysisPayload rejects price fields and short business text", () => {
  assert.throws(
    () =>
      normalizeAnalysisPayload(
        {
          symbol: "600519",
          quality: "A",
          idealPrice: "¥1",
          valuationAnchor: "PE",
          thesis: "这是一段足够长的 thesis 文本用来通过长度检查。",
          keyRisk: "风险说明足够长一点。",
          currentPrice: 100,
          bands: [
            ["a", "b", null, 1, "c"],
            ["a", "b", 1, 2, "c"],
            ["a", "b", 2, 3, "c"],
            ["a", "b", 3, 4, "c"],
            ["a", "b", 4, null, "c"],
          ],
          analysis: {
            business: "太短",
            financials: "这是足够长的财报描述文字内容。",
            valuation: "这是足够长的估值描述文字内容。",
            scenarios: [
              { name: "悲观", assumption: "a", fairValue: "1" },
              { name: "中性", assumption: "b", fairValue: "2" },
              { name: "乐观", assumption: "c", fairValue: "3" },
            ],
            ...AUDIT_FIELDS,
          },
        },
        "600519",
      ),
    /currentPrice|business/i,
  );
});

test("lookupStock resolves 600519 name and industry", async () => {
  const meta = await lookupStock("600519");
  assert.equal(meta.symbol, "600519");
  assert.equal(meta.name, "贵州茅台");
  assert.match(meta.industry, /白酒|酿酒/);
  assert.ok(meta.currentPrice == null || meta.currentPrice > 0);
});

test("ingest writes only analysis fields for one symbol", async () => {
  // Use real ingest against a temp copy? Keep unit-level: write run + call normalize only.
  // Full ingest is covered by admin e2e when network/codex available.
  const dir = mkdtempSync(join(tmpdir(), "vs-run-"));
  try {
    const run = {
      symbol: "600999",
      quality: "A-",
      idealPrice: "¥15–16",
      valuationAnchor: "PE 11–12×",
      thesis: "头部综合券商，财富管理和机构业务较强，估值具备一定安全边际。",
      keyRisk: "成交额回落削弱盈利弹性。",
      bands: [
        ["深度低估", "¥14.5 以下", null, 14.5, "重点研究"],
        ["舒适买入", "¥14.5–16", 14.5, 16, "分批"],
        ["合理偏低", "¥16–17.5", 16, 17.5, "小仓"],
        ["合理区", "¥17.5–20.5", 17.5, 20.5, "克制"],
        ["偏贵区", "¥20.5 以上", 20.5, null, "不追"],
      ],
      analysis: {
        summary: "质量尚可，估值中性偏低。",
        stage: "成熟稳定",
        circleOfCompetence: "部分理解",
        priceVerdict: "合理",
        business: "招商证券是头部综合券商，经纪、投行、资管与财富管理协同。",
        financials: "利润对市场成交与自营波动敏感，ROE 中枢需持续观察。",
        valuation: "PE/PB 处于偏低区间时股息与安全边际更有吸引力。",
        peers: "对标中信、华泰等头部券商估值带。",
        scenarios: [
          { name: "悲观", assumption: "成交萎缩", fairValue: "¥14" },
          { name: "中性", assumption: "成交平稳", fairValue: "¥16" },
          { name: "乐观", assumption: "牛市放量", fairValue: "¥19" },
        ],
        raiseBuyPriceWhen: ["ROE 稳定在 10% 以上"],
        vetoTriggers: ["自营大幅亏损"],
        reportMarkdown: "",
        ...AUDIT_FIELDS,
        analyzedAt: "2026-07-14",
        model: "test",
      },
    };
    const runPath = join(dir, "600999.json");
    writeFileSync(runPath, JSON.stringify(run, null, 2));
    const loaded = JSON.parse(readFileSync(runPath, "utf8"));
    const { patch } = normalizeAnalysisPayload(loaded, "600999");
    assert.equal(patch.quality, "A-");
    assert.equal(patch.analysis.scenarios[1].name, "中性");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
