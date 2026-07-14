export type ValuationBand = {
  level: number;
  name: string;
  rangeLabel: string;
  lowerBound: number | null;
  upperBound: number | null;
  action: string;
};

export type AnalysisScenario = {
  name: string;
  assumption: string;
  fairValue: string;
};

export type StockAnalysis = {
  summary: string;
  stage: string | null;
  circleOfCompetence: string | null;
  priceVerdict: string | null;
  business: string | null;
  financials: string | null;
  valuation: string | null;
  peers: string | null;
  scenarios: AnalysisScenario[];
  raiseBuyPriceWhen: string[];
  vetoTriggers: string[];
  reportMarkdown: string | null;
  analyzedAt: string | null;
  model: string | null;
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
  analysis?: StockAnalysis | null;
  bands: ValuationBand[];
};
