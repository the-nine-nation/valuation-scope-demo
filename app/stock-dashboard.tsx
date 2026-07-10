"use client";

import { useMemo, useState } from "react";
import type { Stock, ValuationBand } from "./types";

const bandColors = ["#28a873", "#9bc85b", "#edc84f", "#ef8d45", "#e2544f"];
const bandSoftColors = ["#e9f6ef", "#f2f8e7", "#fff8dd", "#fff0e4", "#fdebea"];

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

export function StockDashboard({ stocks }: { stocks: Stock[] }) {
  const [activeId, setActiveId] = useState(stocks[0]?.id ?? 0);
  const [query, setQuery] = useState("");
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const activeStock = stocks.find((stock) => stock.id === activeId) ?? stocks[0];
  const filteredStocks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return stocks;
    return stocks.filter(
      (stock) =>
        stock.name.toLowerCase().includes(normalized) ||
        stock.symbol.toLowerCase().includes(normalized) ||
        stock.industry.toLowerCase().includes(normalized),
    );
  }, [query, stocks]);

  if (!activeStock) return null;

  const currentBand = getCurrentBand(activeStock);
  const markerPosition = getMarkerPosition(activeStock, currentBand);

  const selectStock = (id: number) => {
    setActiveId(id);
    setMobileListOpen(false);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="估值刻度首页">
          <span className="brand-sign" aria-hidden="true"><i /><i /><i /></span>
          <span>
            <strong>估值刻度</strong>
            <small>VALUATION SCOPE</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="live-dot" />
          <span>演示数据 · 来源《股票分析.md》</span>
        </div>
      </header>

      <div className="workspace" id="top">
        <aside className={`stock-panel ${mobileListOpen ? "is-open" : ""}`}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">观察池</span>
              <h2>{stocks.length} 只股票</h2>
            </div>
            <button
              className="mobile-close"
              type="button"
              onClick={() => setMobileListOpen(false)}
              aria-label="关闭股票列表"
            >
              ×
            </button>
          </div>

          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、代码或行业"
              aria-label="搜索股票"
            />
          </label>

          <div className="stock-list" role="list">
            {filteredStocks.map((stock) => {
              const band = getCurrentBand(stock);
              const isActive = stock.id === activeStock.id;
              return (
                <button
                  type="button"
                  className={`stock-item ${isActive ? "active" : ""}`}
                  onClick={() => selectStock(stock.id)}
                  key={stock.id}
                  aria-current={isActive ? "true" : undefined}
                >
                  <StockMark symbol={stock.symbol} />
                  <span className="stock-item-copy">
                    <strong>{stock.name}</strong>
                    <small>{stock.symbol} · {stock.industry}</small>
                  </span>
                  <span className="stock-item-value">
                    <strong>¥{stock.currentPrice.toFixed(2)}</strong>
                    <small style={{ color: bandColors[band.level - 1] }}>{band.name}</small>
                  </span>
                </button>
              );
            })}
            {filteredStocks.length === 0 && (
              <p className="empty-state">没有找到匹配的股票</p>
            )}
          </div>

          <div className="panel-note">
            <span>i</span>
            <p>区间是研究纪律，不代表收益承诺。基本面发生变化时需要重新评估。</p>
          </div>
        </aside>

        {mobileListOpen && <button className="panel-backdrop" aria-label="关闭股票列表" onClick={() => setMobileListOpen(false)} />}

        <section className="dashboard">
          <div className="mobile-stock-switcher">
            <button type="button" onClick={() => setMobileListOpen(true)}>
              <span>切换股票</span>
              <strong>{activeStock.name} · {activeStock.symbol}</strong>
              <b>⌄</b>
            </button>
          </div>

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
                <div>
                  <span>估值判断</span>
                  <strong>{activeStock.valuation}</strong>
                </div>
                <div>
                  <span>理想买点</span>
                  <strong>{activeStock.idealPrice}</strong>
                </div>
                <div>
                  <span>估值锚</span>
                  <strong>{activeStock.valuationAnchor}</strong>
                </div>
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
      </div>
    </main>
  );
}
