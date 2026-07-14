import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../../apps/web/dist/server/index.js", import.meta.url);
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
  assert.match(html, /现价落在哪一档估值？/);
  assert.match(html, /估值：低估 → 高估/);
  assert.match(html, /距理想买点：近 → 远/);
  assert.match(html, /价格：低 → 高/);
  assert.match(html, /查看招商证券详情/);
  assert.match(html, /较理想高|贴近理想|已在理想区|低于理想/);
  assert.match(html, /可多选/);
  assert.match(html, /mini-scale-marker/);
  const cardCount = (html.match(/class="stock-card"/g) ?? []).length;
  assert.ok(cardCount >= 6, `expected >=6 stock cards, got ${cardCount}`);
  assert.equal((html.match(/mini-scale-marker/g) ?? []).length, cardCount);
  assert.match(html, /数据已从 SQLite 快照载入/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("ships stocks with exactly five valuation bands and analysis payload", async () => {
  const raw = await readFile(
    new URL("../../apps/web/app/data/stocks.generated.json", import.meta.url),
    "utf8",
  );
  const stocks = JSON.parse(raw);

  assert.ok(stocks.length >= 6);
  assert.equal(stocks[0].name, "招商证券");
  for (const stock of stocks) {
    assert.equal(stock.bands.length, 5, `${stock.name} should have five bands`);
    assert.deepEqual(
      stock.bands.map((band) => band.level),
      [1, 2, 3, 4, 5],
    );
    assert.ok(stock.analysis, `${stock.name} should carry analysis`);
    assert.ok(
      stock.analysis.business && stock.analysis.business.length >= 20,
      `${stock.name} analysis.business too short`,
    );
  }
});
