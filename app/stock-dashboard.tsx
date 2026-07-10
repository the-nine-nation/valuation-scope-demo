"use client";

import { useMemo, useState } from "react";
import type { Stock, ValuationBand } from "./types";

const bandColors = ["#28a873", "#9bc85b", "#edc84f", "#ef8d45", "#e2544f"];
const bandSoftColors = ["#e9f6ef", "#f2f8e7", "#fff8dd", "#fff0e4", "#fdebea"];
const bandDescriptions = ["低估可买", "偏低可布局", "合理观察", "偏高谨慎", "高估回避"];

type SortKey = "level-asc" | "level-desc" | "name" | "symbol" | "price-asc" | "price-desc" | "industry";

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

function StockMark({ symbol }: { symbol: string }) {
  const number = symbol.replace(/\D/g, "").slice(-2);
  return <span className="stock-mark" aria-hidden="true">{number}</span>;
}

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <button className="brand brand-button" type="button" onClick={onHome} aria-label="返回股票总览">
      <span className="brand-sign" aria-hidden="true"><i /><i /><i /></span>
      <span>
        <strong>估值刻度</strong>
        <small>VALUATION SCOPE</small>
      </span>
    </button>
  );
}

export function StockDashboard({ stocks }: { stocks: Stock[] }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("level-asc");

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

  const visibleStocks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const collator = new Intl.Collator("zh-CN", { numeric: true });
    const matches = stocks.filter((stock) => {
      const matchesText = !normalized ||
        stock.name.toLocaleLowerCase("zh-CN").includes(normalized) ||
        stock.symbol.toLocaleLowerCase("zh-CN").includes(normalized) ||
        stock.industry.toLocaleLowerCase("zh-CN").includes(normalized);
      return matchesText;
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
      return collator.compare(a.name, b.name);
    });
  }, [query, sortBy, stocks]);

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

    return (
      <main className="app-shell">
        <header className="topbar">
          <Brand onHome={goHome} />
          <div className="topbar-meta">
            <span className="live-dot" />
            <span>演示数据 · 来源《股票分析.md》</span>
          </div>
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
                <p>{activeStock.symbol} · {activeStock.industry} · 文档口径 {activeStock.asOf}</p>
              </div>
            </div>
            <div className="price-block">
              <span>参考价格</span>
              <strong><small>¥</small>{activeStock.currentPrice.toFixed(2)}</strong>
              <em style={{ color: bandColors[currentBand.level - 1], background: bandSoftColors[currentBand.level - 1] }}>
                第 {currentBand.level} 层 · {currentBand.name}
              </em>
            </div>
          </div>

          <section className="valuation-card" aria-labelledby="valuation-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">五层估值温度</span>
                <h2 id="valuation-title">现在处于什么位置？</h2>
              </div>
              <span className="source-chip">固定 5 层 · 绿 → 红</span>
            </div>

            <div className="scale-wrap">
              <div className="scale-marker" style={{ left: `${markerPosition}%` }}>
                <span>当前 ¥{activeStock.currentPrice.toFixed(2)}</span>
                <i />
              </div>
              <div className="valuation-scale" aria-label={`${activeStock.name}五层估值区间`}>
                {activeStock.bands.map((band, index) => (
                  <div
                    className={`scale-band ${band.level === currentBand.level ? "current" : ""}`}
                    style={{ background: bandColors[index] }}
                    key={band.level}
                  >
                    <span>0{band.level}</span>
                    <strong>{band.name}</strong>
                    <small>{band.rangeLabel}</small>
                  </div>
                ))}
              </div>
              <div className="scale-caption">
                <span>安全边际更厚</span>
                <span>估值风险更高</span>
              </div>
            </div>

            <div className="band-grid">
              {activeStock.bands.map((band, index) => (
                <article
                  className={`band-card ${band.level === currentBand.level ? "current" : ""}`}
                  style={{ "--band-color": bandColors[index], "--band-soft": bandSoftColors[index] } as React.CSSProperties}
                  key={band.level}
                >
                  <div className="band-card-head">
                    <span>{band.level}</span>
                    {band.level === currentBand.level && <em>当前位置</em>}
                  </div>
                  <strong>{band.name}</strong>
                  <b>{band.rangeLabel}</b>
                  <p>{band.action}</p>
                </article>
              ))}
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

          <footer className="dashboard-footer">
            <span>数据已从 SQLite 快照载入</span>
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
        <div className="topbar-meta">
          <span className="live-dot" />
          <span>共 {stocks.length} 只股票 · SQLite 快照</span>
        </div>
      </header>

      <section className="overview-page" id="top">
        <div className="overview-heading">
          <div>
            <span className="eyebrow">股票估值总览</span>
            <h1>一只股票，一个格子</h1>
            <p>所有股票在同一张网格里，切换排序条件即可重新排列。</p>
          </div>
          <div className="valuation-breakdown" aria-label="估值层级分布">
            {bandCounts.map(({ level, count }) => (
              <span key={level}>
                <i style={{ background: bandColors[level - 1] }} />
                第 {level} 层 <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>

        <section className="stock-browser" aria-labelledby="stock-browser-title">
          <div className="browser-heading">
            <div>
              <span className="eyebrow">观察池</span>
              <h2 id="stock-browser-title">全部股票</h2>
            </div>
            <p aria-live="polite">{visibleStocks.length} 个格子 · 共 {stocks.length} 只股票</p>
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
                <option value="level-asc">估值：绿 → 红</option>
                <option value="level-desc">估值：红 → 绿</option>
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
              return (
                <button
                  className="stock-card"
                  style={{ "--stock-color": color, "--stock-soft": bandSoftColors[band.level - 1] } as React.CSSProperties}
                  type="button"
                  onClick={() => openStock(stock.id)}
                  key={stock.id}
                  aria-label={`查看${stock.name}详情，当前第${band.level}层${band.name}`}
                >
                  <span className="card-color-bar" />
                  <span className="stock-card-top">
                    <StockMark symbol={stock.symbol} />
                    <span className="stock-card-status">第 {band.level} 层 · {band.name}</span>
                  </span>
                  <span className="stock-card-name">
                    <strong>{stock.name}</strong>
                    <small>{stock.symbol} · {stock.industry}</small>
                  </span>
                  <span className="stock-card-price">
                    <small>参考价格</small>
                    <strong><b>¥</b>{stock.currentPrice.toFixed(2)}</strong>
                  </span>
                  <span className="mini-scale" aria-hidden="true">
                    {bandColors.map((segmentColor, index) => (
                      <i
                        className={index + 1 === band.level ? "current" : ""}
                        style={{ background: segmentColor }}
                        key={segmentColor}
                      />
                    ))}
                  </span>
                  <span className="stock-card-metrics">
                    <span><small>理想买点</small><strong>{stock.idealPrice}</strong></span>
                    <span><small>公司质量</small><strong>{stock.quality}</strong></span>
                  </span>
                  <span className="stock-card-footer">
                    <small>{bandDescriptions[band.level - 1]}</small>
                    <strong>查看详情 <span aria-hidden="true">→</span></strong>
                  </span>
                </button>
              );
            })}

            {visibleStocks.length === 0 && (
              <div className="grid-empty">
                <strong>没有找到匹配的股票</strong>
                <p>换一个关键词再试试。</p>
                <button type="button" onClick={() => setQuery("")}>清除搜索</button>
              </div>
            )}
          </div>
        </section>

        <footer className="dashboard-footer overview-footer">
          <span>数据已从 SQLite 快照载入</span>
          <span>仅作研究演示，不构成投资建议</span>
        </footer>
      </section>
    </main>
  );
}
