// フレームワーク：②に PEST・ファイブフォースが最初から → SWOT を足して象限を書く → 必須にする → ポジショニング図に点
// → エディタで独自のフレームワーク（表・2×2・図）を作る → ⑦に足して図に要素を足す
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/frameworks.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(30000);
page.on("dialog", (d) => d.accept("規制当局"));
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "FW");
await page.fill("input[name=email]", `fw-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/new`);
for (const a of ["共働き世帯の家計簿アプリ", "共働きの夫婦。締め処理に時間がかかる", "レシートを撮るだけで締めまで終わる。MVP で"]) {
  await page.getByText("考えています…").waitFor({ state: "detached" });
  await page.getByLabel("返事").fill(a);
  await btn("送信", true).click();
}
await page.getByText("作れます", { exact: true }).waitFor();
await page.getByLabel("プロダクト名").fill("分析の家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// ②：PEST とファイブフォースが最初から足してある
await page.goto(`${BASE}/p/${pid}/s/s02`);
const parts = page.getByRole("region", { name: "足したフレームワーク" });
await parts.getByRole("heading", { name: "PEST 分析" }).waitFor();
await parts.getByRole("heading", { name: "ファイブフォース分析" }).waitFor();
// SWOT を足して、象限に書いて保存。必須にする
await btn("フレームワークを足す").click();
await page.getByRole("region", { name: "足すフレームワークを選ぶ" }).or(page.getByLabel("足すフレームワークを選ぶ")).getByRole("button", { name: /SWOT 分析/ }).click();
const swot = page.locator('[data-part="swot"]');
await swot.getByLabel("SWOT：強み（Strengths）").fill("レシート読み取りの精度\n共働きに特化");
await swot.getByLabel("SWOT：機会（Opportunities）").fill("キャッシュレス決済の普及");
await swot.getByRole("button", { name: "保存", exact: true }).click();
await swot.getByText("保存しました").waitFor();
await swot.getByLabel("必須にする").click({ force: true });
await swot.getByText("必須", { exact: true }).waitFor();
// ポジショニングマップを足して点を足す
await btn("フレームワークを足す").click();
await page.getByLabel("足すフレームワークを選ぶ").getByRole("button", { name: /ポジショニングマップ/ }).click();
const pos = page.locator('[data-part="positioning-map"]');
await pos.getByRole("button", { name: "点を足す" }).click();
await pos.getByLabel("名前").first().fill("自社アプリ");
await pos.getByRole("button", { name: "保存", exact: true }).click();
await pos.getByText("保存しました").waitFor();
await shot("f1-stage", true);

// エディタ：独自のフレームワークを作る（表・2×2・図）
await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: "フレームワーク" }).click();
await page.waitForURL(/\/frameworks$/);
await btn("フレームワークを作る").click();
const ed = page.getByRole("region", { name: "フレームワークの編集" });
await ed.getByLabel("フレームワークの id").fill("risk-review");
await ed.getByLabel("フレームワークの名前").fill("リスク評価");
await ed.getByLabel("分類").fill("社内");
await ed.getByLabel("工程 s07").click();
await ed.getByRole("button", { name: "2×2 の象限" }).click();
await ed.getByLabel("部品の見出し").fill("発生×影響");
await ed.getByLabel("左上の象限").fill("高頻度×大影響");
await ed.getByRole("button", { name: "図（ノードと線）" }).click();
await ed.getByLabel("部品の見出し").fill("リスクの連鎖");
await ed.getByLabel("ノードの種類").fill("原因、事象、影響");
await ed.getByRole("button", { name: "保存する" }).click();
await page.getByText("保存しました").waitFor();
await page.getByRole("button", { name: /リスク評価/ }).first().waitFor();
await shot("f2-editor", true);

// ⑦に足して、図に要素を足して保存
await page.goto(`${BASE}/p/${pid}/s/s07`);
await btn("フレームワークを足す").click();
await page.getByLabel("足すフレームワークを選ぶ").getByRole("button", { name: /リスク評価/ }).click();
const risk = page.locator('[data-part="risk-review"]');
await risk.getByRole("button", { name: "要素を足す" }).click();
await risk.getByRole("button", { name: "保存", exact: true }).last().click();
await risk.getByText("保存しました").waitFor();
await shot("f3-custom", true);
console.log(`ok product=${pid}`);
await browser.close();
