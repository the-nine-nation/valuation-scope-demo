"use client";

import { useMemo, useState } from "react";
import type { Stock, ValuationBand } from "./types";

const bandColors = ["#34d399", "#a3e635", "#fbbf24", "#fb923c", "#f87171"];
const bandSoftColors = [
  "rgba(52, 211, 153, 0.14)",
  "rgba(163, 230, 53, 0.14)",
  "rgba(251, 191, 36, 0.14)",
  "rgba(251, 146, 60, 0.14)",
  "rgba(248, 113, 113, 0.14)",
];
/** 现价落在该档时，对「估值程度」的统一解读（跨股票一致） */
const bandValuationLabels = ["低估", "偏低", "合理", "偏高", "高估"];
/** 现价落在该档时的动作提示 */
const bandActionLabels = ["可买", "可布局", "观察", "谨慎", "回避"];
const bandDescriptions = bandValuationLabels.map(
  (label, index) => `${label}${bandActionLabels[index]}`,
);

type SortKey =
  | "level-asc"
  | "level-desc"
  | "name"
  | "symbol"
  | "price-asc"
  | "price-desc"
  | "industry"
  | "ideal-gap";

type IdealGap = {
  status: "in" | "near" | "above" | "below";
  /** 相对理想上沿的溢价%（above/near 为正）；below 为折价% */
  pct: number;
  shortLabel: string;
  detailLabel: string;
};

type BandProximity = {
  toCheaper: { amount: number; pct: number; nextName: string } | null;
  toDearer: { amount: number; pct: number; nextName: string } | null;
};

function getCurrentBand(stock: Stock) {
  return (
    stock.bands.find((band) => {
      const aboveLower = band.lowerBound === null || stock.currentPrice >= band.lowerBound;
      const belowUpper = band.upperBound === null || stock.currentPrice < band.upperBound;
      return aboveLower && belowUpper;
    }) ?? stock.bands[stock.bands.length - 1]
  );
}

function getMarkerPosition(stock: Stock, currentBand: ValuationBand) {
  const index = currentBand.level - 1;
  let progress = 0.5;

  if (currentBand.lowerBound !== null && currentBand.upperBound !== null) {
    progress =
      (stock.currentPrice - currentBand.lowerBound) /
      (currentBand.upperBound - currentBand.lowerBound);
  } else if (currentBand.upperBound !== null) {
    progress = 0.72;
  } else if (currentBand.lowerBound !== null) {
    const previous = stock.bands[index - 1];
    const span =
      previous?.lowerBound !== null && previous?.upperBound !== null
        ? previous.upperBound - previous.lowerBound
        : Math.max(currentBand.lowerBound * 0.15, 1);
    progress = Math.min((stock.currentPrice - currentBand.lowerBound) / span, 0.82);
  }

  return Math.min(Math.max((index + progress) * 20, 3), 97);
}

/** 解析 idealPrice：¥15–16 / ¥30 以下 */
function parseIdealPrice(idealPrice: string): { low: number | null; high: number | null } {
  const cleaned = idealPrice.replace(/[¥￥元\s]/g, "");
  if (cleaned.includes("以下")) {
    const high = Number.parseFloat(cleaned);
    return Number.isFinite(high) ? { low: null, high } : { low: null, high: null };
  }
  if (cleaned.includes("以上")) {
    const low = Number.parseFloat(cleaned);
    return Number.isFinite(low) ? { low, high: null } : { low: null, high: null };
  }
  const range = cleaned.match(/([\d.]+)[–—-]([\d.]+)/);
  if (range) {
    return { low: Number.parseFloat(range[1]), high: Number.parseFloat(range[2]) };
  }
  const single = cleaned.match(/([\d.]+)/);
  if (single) {
    const value = Number.parseFloat(single[1]);
    return { low: value, high: value };
  }
  return { low: null, high: null };
}

function formatPct(value: number) {
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(1);
}

function getIdealGap(stock: Stock): IdealGap | null {
  const { low, high } = parseIdealPrice(stock.idealPrice);
  if (low === null && high === null) return null;

  const price = stock.currentPrice;
  const ceiling = high ?? low!;
  const floor = low ?? null;

  if (price <= ceiling && (floor === null || price >= floor)) {
    return {
      status: "in",
      pct: 0,
      shortLabel: "已在理想区",
      detailLabel: `现价已在理想买点 ${stock.idealPrice} 内`,
    };
  }

  if (floor !== null && price < floor) {
    const pct = ((floor - price) / floor) * 100;
    return {
      status: "below",
      pct,
      shortLabel: `低于理想 ${formatPct(pct)}%`,
      detailLabel: `现价低于理想下沿，较 ¥${floor.toFixed(2)} 便宜约 ${formatPct(pct)}%`,
    };
  }

  // 现价高于理想上沿
  const pct = ((price - ceiling) / ceiling) * 100;
  const dropNeeded = ((price - ceiling) / price) * 100;
  // 溢价很小：视为贴近理想区，避免 0.4% 这种“几乎在区”却显示「较理想高」
  if (pct < 2) {
    return {
      status: "near",
      pct,
      shortLabel: `贴近理想 (+${formatPct(pct)}%)`,
      detailLabel: `略高于理想上沿 ¥${ceiling.toFixed(2)}（+${formatPct(pct)}%）· 回落约 ${formatPct(dropNeeded)}% 可回到理想区`,
    };
  }
  return {
    status: "above",
    pct,
    shortLabel: `较理想高 ${formatPct(pct)}%`,
    detailLabel: `较理想上沿 ¥${ceiling.toFixed(2)} 高约 ${formatPct(pct)}% · 回落约 ${formatPct(dropNeeded)}% 可触及`,
  };
}

function getBandProximity(stock: Stock, currentBand: ValuationBand): BandProximity {
  const price = stock.currentPrice;
  const index = currentBand.level - 1;
  const cheaperBand = stock.bands[index - 1] ?? null;
  const dearerBand = stock.bands[index + 1] ?? null;

  let toCheaper: BandProximity["toCheaper"] = null;
  let toDearer: BandProximity["toDearer"] = null;

  if (currentBand.lowerBound !== null && cheaperBand) {
    const amount = price - currentBand.lowerBound;
    if (amount > 0) {
      toCheaper = {
        amount,
        pct: (amount / price) * 100,
        nextName: cheaperBand.name,
      };
    }
  }

  if (currentBand.upperBound !== null && dearerBand) {
    const amount = currentBand.upperBound - price;
    if (amount > 0) {
      toDearer = {
        amount,
        pct: (amount / price) * 100,
        nextName: dearerBand.name,
      };
    }
  }

  return { toCheaper, toDearer };
}

function StockMark({ symbol }: { symbol: string }) {
  const number = symbol.replace(/\D/g, "").slice(-2);
  return <span className="stock-mark" aria-hidden="true">{number}</span>;
}

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <button className="brand brand-button" type="button" onClick={onHome} aria-label="返回股票总览">
      <span className="brand-sign" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>估值刻度</strong>
        <small>VALUATION SCOPE</small>
      </span>
    </button>
  );
}

function TopbarMeta({ label }: { label: string }) {
  return (
    <div className="topbar-meta">
      <span className="live-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function formatLevelFilterLabel(levels: number[]) {
  if (levels.length === 0) return "";
  if (levels.length === 1) return bandValuationLabels[levels[0] - 1];
  if (levels.length === 5) return "全部档位";
  return levels.map((level) => bandValuationLabels[level - 1]).join(" · ");
}

export function StockDashboard({ stocks }: { stocks: Stock[] }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("level-asc");
  /** 多选档位；空数组 = 不筛选 */
  const [levelFilters, setLevelFilters] = useState<number[]>([]);

  const activeStock = activeId === null
    ? null
    : stocks.find((stock) => stock.id === activeId) ?? null;

  const bandCounts = useMemo(
    () => [1, 2, 3, 4, 5].map((level) => ({
      level,
      count: stocks.filter((stock) => getCurrentBand(stock).level === level).length,
    })),
    [stocks],
  );

  const hasLevelFilter = levelFilters.length > 0;
  const filterLabel = formatLevelFilterLabel(levelFilters);

  const visibleStocks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const collator = new Intl.Collator("zh-CN", { numeric: true });
    const filterSet = new Set(levelFilters);
    const matches = stocks.filter((stock) => {
      const matchesText = !normalized ||
        stock.name.toLocaleLowerCase("zh-CN").includes(normalized) ||
        stock.symbol.toLocaleLowerCase("zh-CN").includes(normalized) ||
        stock.industry.toLocaleLowerCase("zh-CN").includes(normalized);
      const matchesLevel = filterSet.size === 0 || filterSet.has(getCurrentBand(stock).level);
      return matchesText && matchesLevel;
    });

    return [...matches].sort((a, b) => {
      if (sortBy === "level-asc") {
        return getCurrentBand(a).level - getCurrentBand(b).level || collator.compare(a.name, b.name);
      }
      if (sortBy === "level-desc") {
        return getCurrentBand(b).level - getCurrentBand(a).level || collator.compare(a.name, b.name);
      }
      if (sortBy === "symbol") return collator.compare(a.symbol, b.symbol);
      if (sortBy === "price-asc") return a.currentPrice - b.currentPrice;
      if (sortBy === "price-desc") return b.currentPrice - a.currentPrice;
      if (sortBy === "industry") {
        return collator.compare(a.industry, b.industry) || collator.compare(a.name, b.name);
      }
      if (sortBy === "ideal-gap") {
        const gapA = getIdealGap(a);
        const gapB = getIdealGap(b);
        // 已在区 / 低于理想 / 贴近 → 按溢价从小到大
        const rank = (gap: IdealGap | null) => {
          if (!gap) return 999;
          if (gap.status === "in") return -2;
          if (gap.status === "below") return -1;
          if (gap.status === "near") return gap.pct;
          return 10 + gap.pct;
        };
        return rank(gapA) - rank(gapB) || collator.compare(a.name, b.name);
      }
      return collator.compare(a.name, b.name);
    });
  }, [query, sortBy, stocks, levelFilters]);

  const toggleLevelFilter = (level: number) => {
    setLevelFilters((current) => {
      if (current.includes(level)) {
        return current.filter((item) => item !== level);
      }
      return [...current, level].sort((a, b) => a - b);
    });
  };

  const clearLevelFilters = () => setLevelFilters([]);

  const clearFilters = () => {
    setQuery("");
    setLevelFilters([]);
  };

  const openStock = (id: number) => {
    setActiveId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goHome = () => {
    setActiveId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (activeStock) {
    const currentBand = getCurrentBand(activeStock);
    const markerPosition = getMarkerPosition(activeStock, currentBand);
    const idealGap = getIdealGap(activeStock);
    const proximity = getBandProximity(activeStock, currentBand);
    const color = bandColors[currentBand.level - 1];

    return (
      <main className="app-shell">
        <header className="topbar">
          <Brand onHome={goHome} />
          <TopbarMeta label={`演示数据 · 文档口径 ${activeStock.asOf}`} />
        </header>

        <section className="detail-page" id="top">
          <button className="back-button" type="button" onClick={goHome}>
            <span aria-hidden="true">←</span> 返回股票总览
          </button>

          <div className="stock-hero">
            <div className="hero-identity">
              <StockMark symbol={activeStock.symbol} />
              <div>
                <div className="title-row">
                  <h1>{activeStock.name}</h1>
                  <span>{activeStock.market}</span>
                </div>
                <p>
                  {activeStock.symbol} · {activeStock.industry} · 快照 {activeStock.asOf}
                </p>
              </div>
            </div>
            <div className="price-block">
              <span>参考现价</span>
              <strong>
                <small>¥</small>
                {activeStock.currentPrice.toFixed(2)}
              </strong>
              <em
                style={{
                  color,
                  background: bandSoftColors[currentBand.level - 1],
                }}
              >
                现价相对估值 · {bandValuationLabels[currentBand.level - 1]}
              </em>
              <p className="price-band-hint">
                落在「{currentBand.name}」· {bandDescriptions[currentBand.level - 1]} ·{" "}
                {currentBand.rangeLabel}
              </p>
            </div>
          </div>

          <div className="proximity-strip" aria-label="现价相对区间与理想买点">
            <div className="proximity-item">
              <span>理想买点</span>
              <strong>{activeStock.idealPrice}</strong>
              {idealGap && (
                <em className={`gap-pill gap-${idealGap.status}`}>{idealGap.shortLabel}</em>
              )}
              {idealGap && <small>{idealGap.detailLabel}</small>}
            </div>
            <div className="proximity-item">
              <span>更便宜一档</span>
              {proximity.toCheaper ? (
                <>
                  <strong>
                    再跌 ¥{proximity.toCheaper.amount.toFixed(2)}
                  </strong>
                  <em className="gap-pill gap-neutral">
                    约 {formatPct(proximity.toCheaper.pct)}%
                  </em>
                  <small>可进入「{proximity.toCheaper.nextName}」</small>
                </>
              ) : (
                <>
                  <strong>已是最便宜档</strong>
                  <small>或现价已贴着下沿</small>
                </>
              )}
            </div>
            <div className="proximity-item">
              <span>更贵一档</span>
              {proximity.toDearer ? (
                <>
                  <strong>
                    再涨 ¥{proximity.toDearer.amount.toFixed(2)}
                  </strong>
                  <em className="gap-pill gap-neutral">
                    约 {formatPct(proximity.toDearer.pct)}%
                  </em>
                  <small>将进入「{proximity.toDearer.nextName}」</small>
                </>
              ) : (
                <>
                  <strong>已是最贵档</strong>
                  <small>或现价已贴着上沿</small>
                </>
              )}
            </div>
          </div>

          <section className="valuation-card" aria-labelledby="valuation-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">现价 × 五档估值</span>
                <h2 id="valuation-title">现价对应哪一档估值？</h2>
              </div>
              <span className="source-chip">低估 → 高估 · 绿 → 红</span>
            </div>

            <p className="valuation-lead">
              现价 <strong>¥{activeStock.currentPrice.toFixed(2)}</strong> 落在第{" "}
              <strong style={{ color }}>
                {currentBand.level}
              </strong>{" "}
              档：估值程度为「
              <strong style={{ color }}>
                {bandValuationLabels[currentBand.level - 1]}
              </strong>
              」，区间「{currentBand.rangeLabel}」，建议「{bandActionLabels[currentBand.level - 1]}」。
            </p>

            <div className="scale-wrap">
              <div className="scale-marker" style={{ left: `${markerPosition}%` }}>
                <span>现价 ¥{activeStock.currentPrice.toFixed(2)}</span>
                <i />
              </div>
              <div className="valuation-scale" aria-label={`${activeStock.name}五档估值区间`}>
                {activeStock.bands.map((band, index) => (
                  <div
                    className={`scale-band ${band.level === currentBand.level ? "current" : ""}`}
                    style={{ background: bandColors[index] }}
                    key={band.level}
                  >
                    <span>{bandValuationLabels[index]}</span>
                    <strong>{band.name}</strong>
                    <small>{band.rangeLabel}</small>
                  </div>
                ))}
              </div>
              <div className="scale-caption">
                <span>← 现价更便宜 · 安全边际更厚</span>
                <span>现价更贵 · 估值风险更高 →</span>
              </div>
            </div>

            <div className="band-grid">
              {activeStock.bands.map((band, index) => {
                const isCurrent = band.level === currentBand.level;
                return (
                  <article
                    className={`band-card ${isCurrent ? "current" : ""}`}
                    style={{ "--band-color": bandColors[index], "--band-soft": bandSoftColors[index] } as React.CSSProperties}
                    key={band.level}
                  >
                    <div className="band-card-head">
                      <span>{band.level}</span>
                      <small className="band-valuation-tag">{bandValuationLabels[index]}</small>
                      {isCurrent && <em>现价在此</em>}
                    </div>
                    <strong>{band.name}</strong>
                    <b>{band.rangeLabel}</b>
                    <p className="band-meaning">
                      现价若在此区间 → 估值<strong>{bandValuationLabels[index]}</strong>，
                      {bandActionLabels[index]}
                    </p>
                    <p>{band.action}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="insight-grid">
            <article className="thesis-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">分析摘要</span>
                  <h2>为什么这样分层？</h2>
                </div>
                <span className="quality-badge">质量 {activeStock.quality}</span>
              </div>
              <blockquote>{activeStock.thesis}</blockquote>
              <div className="metric-row">
                <div><span>估值判断</span><strong>{activeStock.valuation}</strong></div>
                <div><span>理想买点</span><strong>{activeStock.idealPrice}</strong></div>
                <div><span>估值锚</span><strong>{activeStock.valuationAnchor}</strong></div>
              </div>
            </article>

            <article className="risk-card">
              <div className="risk-icon" aria-hidden="true">!</div>
              <span className="eyebrow">关键风险</span>
              <h2>什么会让区间失效？</h2>
              <p>{activeStock.keyRisk}</p>
              <small>出现风险触发信号时，应先更新基本面假设，而不是机械补仓。</small>
            </article>
          </section>

          {activeStock.analysis && (
            <section className="deep-analysis" aria-labelledby="deep-analysis-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">深度研究</span>
                  <h2 id="deep-analysis-title">价值投资详细分析</h2>
                </div>
                <span className="source-chip">
                  {[
                    activeStock.analysis.analyzedAt && `分析日 ${activeStock.analysis.analyzedAt}`,
                    activeStock.analysis.model && `模型 ${activeStock.analysis.model}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "结构化字段"}
                </span>
              </div>

              {activeStock.analysis.summary && (
                <p className="deep-summary">{activeStock.analysis.summary}</p>
              )}

              <div className="deep-tags">
                {activeStock.analysis.stage && (
                  <span className="deep-tag">阶段 · {activeStock.analysis.stage}</span>
                )}
                {activeStock.analysis.circleOfCompetence && (
                  <span className="deep-tag">
                    能力圈 · {activeStock.analysis.circleOfCompetence}
                  </span>
                )}
                {activeStock.analysis.priceVerdict && (
                  <span className="deep-tag">
                    价格判断 · {activeStock.analysis.priceVerdict}
                  </span>
                )}
              </div>

              <div className="deep-grid">
                {activeStock.analysis.business && (
                  <article className="deep-card">
                    <span className="eyebrow">业务与护城河</span>
                    <h3>是不是好公司？</h3>
                    <p>{activeStock.analysis.business}</p>
                  </article>
                )}
                {activeStock.analysis.financials && (
                  <article className="deep-card">
                    <span className="eyebrow">财报质量</span>
                    <h3>利润与现金流靠谱吗？</h3>
                    <p>{activeStock.analysis.financials}</p>
                  </article>
                )}
                {activeStock.analysis.valuation && (
                  <article className="deep-card">
                    <span className="eyebrow">估值位置</span>
                    <h3>现在贵还是便宜？</h3>
                    <p>{activeStock.analysis.valuation}</p>
                  </article>
                )}
                {activeStock.analysis.peers && (
                  <article className="deep-card">
                    <span className="eyebrow">同业定锚</span>
                    <h3>横向怎么比？</h3>
                    <p>{activeStock.analysis.peers}</p>
                  </article>
                )}
              </div>

              {activeStock.analysis.scenarios?.length > 0 && (
                <div className="scenario-block">
                  <div className="section-heading compact">
                    <div>
                      <span className="eyebrow">三情景</span>
                      <h3>悲观 / 中性 / 乐观</h3>
                    </div>
                  </div>
                  <div className="scenario-grid">
                    {activeStock.analysis.scenarios.map((scenario) => (
                      <article className="scenario-card" key={scenario.name}>
                        <strong>{scenario.name}</strong>
                        <p>{scenario.assumption}</p>
                        <em>合理价值 · {scenario.fairValue}</em>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <div className="deep-lists">
                {activeStock.analysis.raiseBuyPriceWhen?.length > 0 && (
                  <article className="list-card">
                    <span className="eyebrow">上修买入价条件</span>
                    <h3>什么情况下可以提高买点？</h3>
                    <ul>
                      {activeStock.analysis.raiseBuyPriceWhen.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                )}
                {activeStock.analysis.vetoTriggers?.length > 0 && (
                  <article className="list-card list-card-risk">
                    <span className="eyebrow">否决触发</span>
                    <h3>什么情况下区间作废？</h3>
                    <ul>
                      {activeStock.analysis.vetoTriggers.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                )}
              </div>

              {activeStock.analysis.reportMarkdown && (
                <article className="report-card">
                  <span className="eyebrow">完整报告</span>
                  <h3>研究笔记</h3>
                  <pre className="report-md">{activeStock.analysis.reportMarkdown}</pre>
                </article>
              )}
            </section>
          )}

          <footer className="dashboard-footer">
            <span>数据已从 SQLite 快照载入 · 口径 {activeStock.asOf}</span>
            <span>仅作研究演示，不构成投资建议</span>
          </footer>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand onHome={goHome} />
        <TopbarMeta label={`共 ${stocks.length} 只股票 · 演示快照`} />
      </header>

      <section className="overview-page" id="top">
        <div className="overview-heading">
          <div>
            <span className="eyebrow">股票估值总览</span>
            <h1>现价落在哪一档估值？</h1>
            <p>
              用固定五档刻度对照每只股票的现价：从低估可买到高估回避，
              一眼看清买入空间、距理想买点还有多远。
            </p>
          </div>
          {hasLevelFilter && (
            <button
              type="button"
              className="breakdown-clear heading-clear"
              onClick={clearLevelFilters}
            >
              清除筛选 · {filterLabel}
            </button>
          )}
        </div>

        <div
          className={`scale-legend ${hasLevelFilter ? "is-filtering" : ""}`}
          role="toolbar"
          aria-label="按现价估值档位多选筛选"
        >
          <div className="scale-legend-head">
            <span>现价分布</span>
            <small>
              {hasLevelFilter
                ? `已选 ${levelFilters.length} 档 · 可继续点选叠加`
                : "可多选 · 点选叠加 · 再点取消"}
            </small>
          </div>
          <div className="scale-legend-row">
            {bandValuationLabels.map((label, index) => {
              const level = index + 1;
              const active = levelFilters.includes(level);
              const count = bandCounts[index]?.count ?? 0;
              const empty = count === 0;
              return (
                <button
                  type="button"
                  className={`scale-legend-item ${active ? "active" : ""} ${empty ? "empty" : ""}`}
                  key={label}
                  style={{ "--legend-color": bandColors[index] } as React.CSSProperties}
                  onClick={() => !empty && toggleLevelFilter(level)}
                  aria-pressed={active}
                  disabled={empty}
                  title={
                    empty
                      ? `当前没有处于「${bandDescriptions[index]}」的股票`
                      : active
                        ? `取消筛选：${bandDescriptions[index]}`
                        : `加入筛选：${bandDescriptions[index]}`
                  }
                >
                  <i style={{ background: bandColors[index] }} />
                  <div>
                    <strong>
                      {level} · {label}
                      <b className="legend-count">{count}</b>
                    </strong>
                    <small>{bandDescriptions[index]}</small>
                  </div>
                </button>
              );
            })}
          </div>
          {hasLevelFilter && (
            <div className="scale-legend-active" aria-live="polite">
              <span>
                筛选中：
                {levelFilters.map((level) => (
                  <em
                    key={level}
                    style={{
                      color: bandColors[level - 1],
                      background: bandSoftColors[level - 1],
                    }}
                  >
                    {bandValuationLabels[level - 1]}
                  </em>
                ))}
              </span>
              <button type="button" className="breakdown-clear" onClick={clearLevelFilters}>
                全部清除
              </button>
            </div>
          )}
        </div>

        <section className="stock-browser" aria-labelledby="stock-browser-title">
          <div className="browser-heading">
            <div>
              <span className="eyebrow">观察池</span>
              <h2 id="stock-browser-title">
                {hasLevelFilter
                  ? `筛选：现价 · ${filterLabel}`
                  : "按现价估值排序浏览"}
              </h2>
            </div>
            <p aria-live="polite">
              {visibleStocks.length} 只匹配 · 共 {stocks.length} 只股票
              {hasLevelFilter && ` · ${levelFilters.length} 档`}
            </p>
          </div>

          <div className="browser-toolbar">
            <label className="search-box grid-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、代码或行业"
                aria-label="搜索股票"
              />
            </label>

            <label className="select-control">
              <span>排序</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
                <option value="level-asc">估值：低估 → 高估</option>
                <option value="level-desc">估值：高估 → 低估</option>
                <option value="ideal-gap">距理想买点：近 → 远</option>
                <option value="name">名称：拼音顺序</option>
                <option value="symbol">股票代码</option>
                <option value="price-asc">价格：低 → 高</option>
                <option value="price-desc">价格：高 → 低</option>
                <option value="industry">行业名称</option>
              </select>
            </label>
          </div>

          <div className="stock-grid overview-stock-grid">
            {visibleStocks.map((stock) => {
              const band = getCurrentBand(stock);
              const color = bandColors[band.level - 1];
              const valuationLabel = bandValuationLabels[band.level - 1];
              const idealGap = getIdealGap(stock);
              const markerPosition = getMarkerPosition(stock, band);
              return (
                <button
                  className="stock-card"
                  style={{ "--stock-color": color, "--stock-soft": bandSoftColors[band.level - 1] } as React.CSSProperties}
                  type="button"
                  onClick={() => openStock(stock.id)}
                  key={stock.id}
                  aria-label={`查看${stock.name}详情，现价相对估值${valuationLabel}，${band.name}`}
                >
                  <span className="card-color-bar" />
                  <span className="stock-card-top">
                    <StockMark symbol={stock.symbol} />
                    <span className="stock-card-status">
                      现价 · {valuationLabel}
                    </span>
                  </span>
                  <span className="stock-card-name">
                    <strong>{stock.name}</strong>
                    <small>
                      {stock.symbol} · {stock.industry} · 快照 {stock.asOf}
                    </small>
                  </span>
                  <span className="stock-card-price">
                    <small>参考现价</small>
                    <strong><b>¥</b>{stock.currentPrice.toFixed(2)}</strong>
                    <em className="stock-card-band-line">
                      落在 {band.name} · {band.rangeLabel}
                    </em>
                  </span>
                  <span
                    className="mini-scale"
                    aria-hidden="true"
                    title={`现价位于五档刻度约 ${markerPosition.toFixed(0)}% 处`}
                  >
                    <span className="mini-scale-track">
                      {bandColors.map((segmentColor, index) => (
                        <i
                          className={index + 1 === band.level ? "current" : ""}
                          style={{ background: segmentColor }}
                          key={segmentColor}
                        />
                      ))}
                    </span>
                    <span
                      className="mini-scale-marker"
                      style={{ left: `${markerPosition}%` }}
                    >
                      <b />
                    </span>
                  </span>
                  <span className="stock-card-metrics">
                    <span>
                      <small>理想买点</small>
                      <strong>{stock.idealPrice}</strong>
                      {idealGap && (
                        <em className={`gap-inline gap-${idealGap.status}`}>
                          {idealGap.shortLabel}
                        </em>
                      )}
                    </span>
                    <span>
                      <small>公司质量</small>
                      <strong>{stock.quality}</strong>
                    </span>
                  </span>
                  <span className="stock-card-footer">
                    <small>{bandDescriptions[band.level - 1]}</small>
                    <strong>查看区间 <span aria-hidden="true">→</span></strong>
                  </span>
                </button>
              );
            })}

            {visibleStocks.length === 0 && (
              <div className="grid-empty">
                <strong>没有找到匹配的股票</strong>
                <p>
                  {hasLevelFilter
                    ? "当前筛选档位下没有股票，试试清除筛选或换个关键词。"
                    : "换一个关键词再试试。"}
                </p>
                <button type="button" onClick={clearFilters}>清除筛选与搜索</button>
              </div>
            )}
          </div>
        </section>

        <footer className="dashboard-footer overview-footer">
          <span>数据已从 SQLite 快照载入 · 非实时行情</span>
          <span>仅作研究演示，不构成投资建议</span>
        </footer>
      </section>
    </main>
  );
}
