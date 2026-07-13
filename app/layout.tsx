import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "估值刻度",
  description: "股票五层估值区间演示工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="app-root">{children}</body>
    </html>
  );
}
