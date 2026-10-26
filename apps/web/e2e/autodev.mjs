// 以降の工程の自動開発：⑥で「以降の工程を自動開発する」→ ジョブが進む → プリプロダクト（案ごとの後工程と試作）
// → 並べて比べる → 試作を触る → 採用すると⑧の下書きに入る → ジョブ画面で履歴とトークン量を見る
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/autodev.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(30000);
page.on("dialog", (d) => d.accept());
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "AD");
await page.fill("input[name=email]", `ad-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/new`);
for (const a of ["誰でも小説を書いて読めるアプリ", "書き手と読み手。読まれない・見つからない", "好みで推薦する。MVP で"]) {
  await page.getByText("考えています…").waitFor({ state: "detached" });
  await page.getByLabel("返事").fill(a);
  await btn("送信", true).click();
}
await page.getByText("作れます", { exact: true }).waitFor();
await page.getByLabel("プロダクト名").fill("みんなのノベル");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

await page.goto(`${BASE}/p/${pid}/s/s01`);
await shot("a0-lean-canvas");
await page.goto(`${BASE}/p/${pid}/s/s06`);
await btn("以降の工程を自動開発する").click();
const dlg = page.getByRole("dialog", { name: "以降の工程を自動開発する" });
await dlg.getByLabel("案の数").selectOption("2");
await dlg.getByLabel("違いを出す軸（任意）").fill("最小限, 体験重視");
await shot("a1-start");
await dlg.getByRole("button", { name: "自動開発を始める" }).click();
// 始めるとジョブの画面へ：工程のグラフ（パターンを決める → 案ごとの⑦〜⑪ → 試作）で走り具合を見る
await page.waitForURL(/\/jobs\/[0-9a-f]+$/);
const jobUrl = page.url();
await page.locator(".react-flow__node").filter({ hasText: "パターンを決める" }).waitFor();
for (let i = 0; i < 60 && !(await page.getByText("完了 13").isVisible()); i++) await page.waitForTimeout(1000);
await page.getByText(/13工程：完了 13/).waitFor();
await shot("a1b-job-graph");
await btn("ガント").click();
await shot("a1c-job-gantt");
await page.goto(`${BASE}/jobs`);
await page.getByText("グリッド（実行 × 工程）").waitFor();
await shot("a1d-job-grid", true);
await page.goto(jobUrl);
await page.goto(`${BASE}/p/${pid}/preproducts`);
await page.getByText("できあがり").first().waitFor({ timeout: 60000 });
await page.getByRole("heading", { name: "案A：最小限" }).waitFor();
await page.getByText(/完了/).first().waitFor();
await shot("a2-preproducts", true);

// ステージの画面で案ごとのタブ：⑨を案B で見て、⑨だけ本線に取り込む
await page.goto(`${BASE}/p/${pid}/s/s09`);
await page.getByRole("link", { name: /PP-2 案B：体験重視/ }).click();
await page.waitForURL(/pp=2/);
await page.getByText("の ⑨アプリケーション設計（読み取り専用）").waitFor();
await shot("a2b-stage-pattern-tab", true);
await btn("この工程だけ本線に取り込む").click();
await page.waitForURL(/\/s\/s09$/);
await page.getByRole("link", { name: "本線" }).waitFor();
await page.goto(`${BASE}/p/${pid}/preproducts`);
await btn("案を並べて比べる").or(page.getByRole("link", { name: "案を並べて比べる" })).click();
await page.getByText("PP-1 案A：最小限").waitFor();
await shot("a3-compare", true);

await page.getByRole("link", { name: "詳しく見る" }).first().click();
await page.waitForURL(/preproducts\/\d+$/);
const proto = page.frameLocator("iframe[title$='の試作']");
await proto.getByText(/試作：案/).waitFor();
await proto.locator("input").first().fill("最初の作品");
await proto.getByRole("button", { name: "追加" }).first().click();
await proto.getByText("最初の作品").waitFor();
await shot("a4-detail");
await btn("この案を採用する").click();
await page.getByText("採用しました").waitFor();

await page.goto(`${BASE}/p/${pid}/s/s08`);
await page.getByText("作業中").first().waitFor();

await page.goto(`${BASE}/jobs`);
await page.getByRole("link", { name: "以降の工程の自動開発" }).first().click();
await page.getByText("LLM の使用量").waitFor();
await page.getByText("完了", { exact: true }).last().waitFor();
await shot("a5-job", true);
await page.goto(`${BASE}/jobs`);
await shot("a6-jobs", true);
console.log(JSON.stringify({ pid, ok: true }));
await browser.close();
