export type ValuationBand = {
  level: number;
  name: string;
  rangeLabel: string;
  lowerBound: number | null;
  upperBound: number | null;
  action: string;
};

export type Stock = {
  id: number;
  symbol: string;
  name: string;
  market: string;
  industry: string;
  currentPrice: number;
  asOf: string;
  quality: string;
  valuation: string;
  thesis: string;
  idealPrice: string;
  valuationAnchor: string;
  keyRisk: string;
  bands: ValuationBand[];
};
