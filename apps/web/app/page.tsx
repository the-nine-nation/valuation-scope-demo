import type { Metadata } from "next";
import stocks from "./data/stocks.generated.json";
import { StockDashboard } from "./stock-dashboard";
import type { Stock } from "./types";

export const metadata: Metadata = {
  title: "估值刻度｜股票分层买入区间",
  description: "用五层估值刻度查看股票从低估到高估的价格区间。",
};

export default function Home() {
  return <StockDashboard stocks={stocks as Stock[]} />;
}
