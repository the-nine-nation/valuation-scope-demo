import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the sortable stock overview grid", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>估值刻度｜股票分层买入区间<\/title>/i);
  assert.match(html, /招商证券/);
  assert.match(html, /股票网格/);
  assert.match(html, /估值：绿 → 红/);
  assert.match(html, /按估值颜色/);
  assert.match(html, /查看招商证券详情/);
  assert.match(html, /数据已从 SQLite 快照载入/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("ships six stocks with exactly five valuation bands each", async () => {
  const raw = await readFile(
    new URL("../app/data/stocks.generated.json", import.meta.url),
    "utf8",
  );
  const stocks = JSON.parse(raw);

  assert.equal(stocks.length, 6);
  assert.deepEqual(
    stocks.map((stock) => stock.name),
    ["招商证券", "珀莱雅", "中国太保", "分众传媒", "海尔智家", "紫光国微"],
  );
  for (const stock of stocks) {
    assert.equal(stock.bands.length, 5, `${stock.name} should have five bands`);
    assert.deepEqual(
      stock.bands.map((band) => band.level),
      [1, 2, 3, 4, 5],
    );
  }
});
