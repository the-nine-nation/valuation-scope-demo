/**
 * Shared validation for machine-readable value-investing analysis payloads.
 * Used by ingest-analysis.mjs and admin analyze flow.
 */

export const ANALYSIS_FIELD_KEYS = [
  "summary",
  "stage",
  "circleOfCompetence",
  "priceVerdict",
  "business",
  "financials",
  "valuation",
  "peers",
  "scenarios",
  "raiseBuyPriceWhen",
  "vetoTriggers",
  "reportMarkdown",
  "skillVersion",
  "stepsCompleted",
  "sources",
];

/** Must match data/anysis/charlie-munger-value-investing skill contract */
export const REQUIRED_SKILL_VERSION = "charlie-munger-value-investing@1";

/**
 * Skill workflow steps (SKILL.md 执行流程 0–10).
 * Codex must claim completion for each id in analysis.stepsCompleted.
 */
export const REQUIRED_SKILL_STEPS = [
  "0-scope-circle",
  "1-data-collect",
  "2-valuation-framework",
  "3-quality-stage",
  "4-financial-statements",
  "5-history-peers",
  "6-three-scenarios",
  "7-layered-buy-zones",
  "8-raise-and-veto",
  "9-chinese-report",
  "10-principles-selfcheck",
];

const BAND_NAMES_HINT = ["深度低估/优先", "舒适", "合理偏低/分批", "合理", "偏贵/不宜"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullOrNumber(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function validateSkillVersion(value) {
  const v = String(value ?? "").trim();
  if (!v) {
    throw new Error(
      `analysis.skillVersion required (expected ${REQUIRED_SKILL_VERSION})`,
    );
  }
  if (v !== REQUIRED_SKILL_VERSION) {
    throw new Error(
      `analysis.skillVersion must be "${REQUIRED_SKILL_VERSION}" (got "${v}")`,
    );
  }
  return v;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateStepsCompleted(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `analysis.stepsCompleted must be non-empty array covering: ${REQUIRED_SKILL_STEPS.join(", ")}`,
    );
  }
  const steps = value.map((item, index) => {
    if (!isNonEmptyString(item)) {
      throw new Error(`analysis.stepsCompleted[${index}] must be non-empty string`);
    }
    return item.trim();
  });
  const set = new Set(steps);
  const missing = REQUIRED_SKILL_STEPS.filter((id) => !set.has(id));
  if (missing.length) {
    throw new Error(
      `analysis.stepsCompleted missing required steps: ${missing.join(", ")}`,
    );
  }
  // Keep required order first, then any extra steps Codex added
  const extras = steps.filter((id) => !REQUIRED_SKILL_STEPS.includes(id));
  return [...REQUIRED_SKILL_STEPS, ...extras];
}

/**
 * @param {unknown} value
 * @returns {{ title: string, url?: string|null, asOf?: string|null, kind?: string|null }[]}
 */
export function validateSources(value) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(
      "analysis.sources must be an array of ≥2 items (title required; url/asOf/kind optional)",
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`analysis.sources[${index}] must be object`);
    }
    const title = String(item.title ?? "").trim();
    if (!title) {
      throw new Error(`analysis.sources[${index}].title required`);
    }
    const urlRaw = item.url == null || item.url === "" ? null : String(item.url).trim();
    if (urlRaw && !/^https?:\/\//i.test(urlRaw)) {
      throw new Error(`analysis.sources[${index}].url must be http(s) or null`);
    }
    const asOf =
      item.asOf == null || item.asOf === ""
        ? null
        : String(item.asOf).trim();
    const kind =
      item.kind == null || item.kind === ""
        ? null
        : String(item.kind).trim();
    return {
      title,
      url: urlRaw,
      asOf,
      kind,
    };
  });
}

/**
 * Validate one band tuple: [name, rangeLabel, lower, upper, action]
 */
export function validateBand(band, index) {
  if (!Array.isArray(band) || band.length !== 5) {
    throw new Error(`bands[${index}] must be [name, rangeLabel, lower, upper, action]`);
  }
  const [name, rangeLabel, lower, upper, action] = band;
  if (!isNonEmptyString(name)) throw new Error(`bands[${index}].name required`);
  if (!isNonEmptyString(rangeLabel)) throw new Error(`bands[${index}].rangeLabel required`);
  if (!isNullOrNumber(lower)) throw new Error(`bands[${index}].lower must be number|null`);
  if (!isNullOrNumber(upper)) throw new Error(`bands[${index}].upper must be number|null`);
  if (!isNonEmptyString(action)) throw new Error(`bands[${index}].action required`);
  if (lower !== null && upper !== null && lower > upper) {
    throw new Error(`bands[${index}] lower (${lower}) > upper (${upper})`);
  }
  return [
    name.trim(),
    rangeLabel.trim(),
    lower === null ? null : Math.round(lower * 100) / 100,
    upper === null ? null : Math.round(upper * 100) / 100,
    action.trim(),
  ];
}

export function validateBands(bands) {
  if (!Array.isArray(bands) || bands.length !== 5) {
    throw new Error(`bands must have exactly 5 levels (got ${bands?.length ?? 0}); expected ~ ${BAND_NAMES_HINT.join(" → ")}`);
  }
  return bands.map((band, index) => validateBand(band, index));
}

export function validateScenarios(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length < 3) {
    throw new Error("analysis.scenarios must be an array of at least 3 items");
  }
  return scenarios.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`analysis.scenarios[${index}] must be object`);
    }
    const name = String(item.name ?? "").trim();
    const assumption = String(item.assumption ?? "").trim();
    const fairValue = String(item.fairValue ?? "").trim();
    if (!name || !assumption || !fairValue) {
      throw new Error(`analysis.scenarios[${index}] needs name/assumption/fairValue`);
    }
    return { name, assumption, fairValue };
  });
}

export function validateStringList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value.map((item, index) => {
    if (!isNonEmptyString(item)) {
      throw new Error(`${field}[${index}] must be non-empty string`);
    }
    return item.trim();
  });
}

/**
 * Normalize + validate a run payload written by Codex / skill.
 * @returns {{ symbol, patch, analysis }}
 */
export function normalizeAnalysisPayload(raw, expectedSymbol) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("analysis payload must be a JSON object");
  }

  const symbol = String(raw.symbol ?? expectedSymbol ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(symbol)) {
    throw new Error("payload.symbol must be 6 digits");
  }
  if (expectedSymbol && symbol !== expectedSymbol) {
    throw new Error(`payload.symbol ${symbol} !== expected ${expectedSymbol}`);
  }

  const quality = String(raw.quality ?? "").trim();
  const idealPrice = String(raw.idealPrice ?? "").trim();
  const valuationAnchor = String(raw.valuationAnchor ?? "").trim();
  const thesis = String(raw.thesis ?? "").trim();
  const keyRisk = String(raw.keyRisk ?? "").trim();

  if (!quality) throw new Error("quality required");
  if (!idealPrice) throw new Error("idealPrice required");
  if (!valuationAnchor) throw new Error("valuationAnchor required");
  if (thesis.length < 20) throw new Error("thesis too short (min 20 chars)");
  if (keyRisk.length < 10) throw new Error("keyRisk too short (min 10 chars)");

  const bands = validateBands(raw.bands);

  const analysisIn = raw.analysis && typeof raw.analysis === "object" ? raw.analysis : {};
  // Prefer nested analysis.* audit fields; allow top-level aliases for convenience
  const skillVersion = validateSkillVersion(
    analysisIn.skillVersion ?? raw.skillVersion,
  );
  const stepsCompleted = validateStepsCompleted(
    analysisIn.stepsCompleted ?? raw.stepsCompleted,
  );
  const sources = validateSources(analysisIn.sources ?? raw.sources);

  const analysis = {
    summary: String(analysisIn.summary ?? thesis).trim(),
    stage: String(analysisIn.stage ?? "待判定").trim(),
    circleOfCompetence: String(analysisIn.circleOfCompetence ?? "部分理解").trim(),
    priceVerdict: String(analysisIn.priceVerdict ?? "需要观察").trim(),
    business: String(analysisIn.business ?? "").trim(),
    financials: String(analysisIn.financials ?? "").trim(),
    valuation: String(analysisIn.valuation ?? "").trim(),
    peers: String(analysisIn.peers ?? "").trim(),
    scenarios: validateScenarios(
      analysisIn.scenarios ?? [
        { name: "悲观", assumption: "待补充", fairValue: idealPrice },
        { name: "中性", assumption: "待补充", fairValue: idealPrice },
        { name: "乐观", assumption: "待补充", fairValue: idealPrice },
      ],
    ),
    raiseBuyPriceWhen: Array.isArray(analysisIn.raiseBuyPriceWhen)
      ? validateStringList(analysisIn.raiseBuyPriceWhen, "analysis.raiseBuyPriceWhen")
      : ["业绩与质量假设得到持续验证后，可上修买入区间。"],
    vetoTriggers: Array.isArray(analysisIn.vetoTriggers)
      ? validateStringList(analysisIn.vetoTriggers, "analysis.vetoTriggers")
      : [keyRisk],
    reportMarkdown: String(analysisIn.reportMarkdown ?? "").trim(),
    skillVersion,
    stepsCompleted,
    sources,
    analyzedAt:
      String(analysisIn.analyzedAt ?? raw.analyzedAt ?? "").trim() ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    model: String(analysisIn.model ?? raw.model ?? "").trim() || null,
  };

  if (analysis.business.length < 20) {
    throw new Error("analysis.business too short (min 20 chars) — detail page needs real content");
  }
  if (analysis.financials.length < 20) {
    throw new Error("analysis.financials too short (min 20 chars)");
  }
  if (analysis.valuation.length < 20) {
    throw new Error("analysis.valuation too short (min 20 chars)");
  }

  // Forbidden live-price fields on analysis authority source
  for (const key of ["currentPrice", "asOf", "valuation"]) {
    if (raw[key] != null) {
      throw new Error(`do not set ${key} on analysis payload (belongs in prices snapshot)`);
    }
  }

  return {
    symbol,
    patch: {
      quality,
      idealPrice,
      valuationAnchor,
      thesis,
      keyRisk,
      bands,
      analysis,
    },
  };
}

/** JSON Schema-ish description embedded in prompts / skill docs */
export const ANALYSIS_RUN_CONTRACT = `{
  "symbol": "600519",
  "quality": "A / A- / B+ ...",
  "idealPrice": "¥55–58 或 ¥30 以下",
  "valuationAnchor": "2026E PE 15–17× / P/EV ...",
  "thesis": "2–4 句中文核心投资逻辑（卡片摘要）",
  "keyRisk": "1–2 句关键否决风险",
  "bands": [
    ["档位名", "¥xx 以下", null, 14.5, "操作说明"],
    ["档位名", "¥xx–yy", 14.5, 16, "操作说明"],
    ["档位名", "¥xx–yy", 16, 17.5, "操作说明"],
    ["档位名", "¥xx–yy", 17.5, 20.5, "操作说明"],
    ["档位名", "¥xx 以上", 20.5, null, "操作说明"]
  ],
  "analysis": {
    "summary": "一句话：好公司？好价格？舒服买入区间？",
    "stage": "高成长|成熟稳定|增长换挡|困境修复|衰退",
    "circleOfCompetence": "在圈内|部分理解|不在能力圈",
    "priceVerdict": "便宜|合理|偏贵|需要观察",
    "business": "业务/护城河/能力圈段落（中文，≥20字）",
    "financials": "财报质量与红旗段落（中文，≥20字）",
    "valuation": "历史估值与当前位置段落（中文，≥20字）",
    "peers": "同业/海外可比定锚段落",
    "scenarios": [
      { "name": "悲观", "assumption": "...", "fairValue": "¥xx" },
      { "name": "中性", "assumption": "...", "fairValue": "¥xx" },
      { "name": "乐观", "assumption": "...", "fairValue": "¥xx" }
    ],
    "raiseBuyPriceWhen": ["条件1", "条件2"],
    "vetoTriggers": ["触发1", "触发2"],
    "reportMarkdown": "可选：完整中文报告 Markdown",
    "skillVersion": "${REQUIRED_SKILL_VERSION}",
    "stepsCompleted": ${JSON.stringify(REQUIRED_SKILL_STEPS)},
    "sources": [
      { "title": "公司最新年报/中报", "url": "https://...", "asOf": "YYYY-MM-DD", "kind": "filing" },
      { "title": "行情/估值来源", "url": "https://...", "asOf": "YYYY-MM-DD", "kind": "quote" }
    ],
    "analyzedAt": "YYYY-MM-DD",
    "model": "模型 slug（可选）"
  }
}`;
