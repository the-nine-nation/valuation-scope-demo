"use client";

import { useEffect, useMemo, useState } from "react";
import type { Stock } from "./types";

export type LiveQuote = {
  currentPrice: number;
  asOf: string;
};

type QuotesResponse = {
  asOf: string | null;
  updatedAt?: string;
  live?: boolean;
  quotes: Record<string, LiveQuote>;
  error?: string;
};

const POLL_MS = 30_000;

function resolveBandName(price: number, bands: Stock["bands"]): string {
  const hit = bands.find((band) => {
    const aboveLower = band.lowerBound === null || price >= band.lowerBound;
    const belowUpper = band.upperBound === null || price < band.upperBound;
    return aboveLower && belowUpper;
  });
  return hit?.name ?? bands[bands.length - 1]?.name ?? "—";
}

/**
 * Overlay live Tencent quotes onto SSR snapshot stocks.
 * Falls back to snapshot prices if /api/quotes fails.
 */
export function useLiveQuotes(initialStocks: Stock[]) {
  const [liveMap, setLiveMap] = useState<Record<string, LiveQuote>>({});
  const [liveAsOf, setLiveAsOf] = useState<string | null>(null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [liveOk, setLiveOk] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const symbolsKey = useMemo(
    () => initialStocks.map((s) => s.symbol).join(","),
    [initialStocks],
  );

  useEffect(() => {
    let cancelled = false;
    const symbols = symbolsKey.split(",").filter(Boolean);
    if (symbols.length === 0) return;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as QuotesResponse;
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setLiveMap(data.quotes ?? {});
        setLiveAsOf(data.asOf ?? null);
        setLiveUpdatedAt(data.updatedAt ?? new Date().toISOString());
        setLiveOk(true);
        setLiveError(null);
      } catch (error) {
        if (cancelled) return;
        setLiveOk(false);
        setLiveError(error instanceof Error ? error.message : String(error));
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbolsKey]);

  const stocks = useMemo(() => {
    return initialStocks.map((stock) => {
      const live = liveMap[stock.symbol];
      if (!live || !Number.isFinite(live.currentPrice) || live.currentPrice <= 0) {
        return stock;
      }
      return {
        ...stock,
        currentPrice: live.currentPrice,
        asOf: live.asOf || stock.asOf,
        valuation: resolveBandName(live.currentPrice, stock.bands),
      };
    });
  }, [initialStocks, liveMap]);

  return {
    stocks,
    liveOk,
    liveAsOf,
    liveUpdatedAt,
    liveError,
  };
}
