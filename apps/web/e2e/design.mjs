// ⑨アプリケーション設計・⑩インフラ設計・⑪運用方式設計：AI の下書き → ER図・処理仕様（CRUD・データフロー）・状態遷移・構成図を画面で直す
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/design.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
page.setDefaultTimeout(30000);
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "注文" : undefined));
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "DS");
await page.fill("input[name=email]", `ds-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/new`);
for (const a of ["申込を受け付けるサービス", "個人の利用者。申込の確認に時間がかかる", "申込から完了までを画面で追える。MVP で"]) {
  await page.getByText("考えています…").waitFor({ state: "detached" });
  await page.getByLabel("返事").fill(a);
  await btn("送信", true).click();
}
await page.getByText("作れます", { exact: true }).waitFor();
await page.getByLabel("プロダクト名").fill("申込受付");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

async function draft(sid) {
  await page.goto(`${BASE}/p/${pid}/s/${sid}`);
  await btn("下書きを作って").click();
  const all = page.getByRole("button", { name: /件をすべて採用/ });
  await all.waitFor();
  await all.click();
  await all.waitFor({ state: "detached" });
}

// ⑨：ER図・処理仕様・状態遷移
await draft("s09");
const entity = (id) => page.locator(`.react-flow__node-entity[data-id="${id}"]`);
await entity("E1").getByText("利用者ID").waitFor();
await shot("d1-app-design", true);
// エンティティを押して属性を足す → 保存
await entity("E2").click();
await page.getByLabel("エンティティの論理名").waitFor();
await btn("属性を追加").click();
await page.getByRole("textbox", { name: "属性（論理名）" }).last().fill("申込日時");
await page.getByRole("textbox", { name: "型" }).last().fill("timestamp");
await btn("データモデルを保存").click();
await entity("E2").getByText("申込日時").waitFor();
await btn("データモデルを保存").and(page.locator(":disabled")).waitFor();
await shot("d2-er-edit", true);
// 処理仕様：データフロー図がある
await page.getByRole("img", { name: "申込を受け付けるのデータフロー" }).waitFor();
// CRUD マトリクス：PR-02 の「利用者」に R を付けて保存 → 入出力に反映
await page.getByRole("tab", { name: "CRUD マトリクス" }).click();
const row = page.locator("tr").filter({ hasText: "PR-02" });
await row.locator("td").nth(1).getByRole("button", { name: "R", exact: true }).click();
await btn("処理仕様を保存").click();
await btn("処理仕様を保存").and(page.locator(":disabled")).waitFor();
await row.scrollIntoViewIfNeeded();
await shot("d3-crud");
await page.getByRole("tab", { name: "全体のデータフロー" }).click();
await page.getByRole("img", { name: "全体のデータフロー" }).scrollIntoViewIfNeeded();
await shot("d4-dfd", true);
await page.getByRole("tab", { name: "処理ごと" }).click();
await page.getByRole("button", { name: /PR-02/ }).click();
await page.getByLabel("処理名").and(page.locator("[value='申込を確認する']")).waitFor();
const ios = await page.locator("input[list='pf-tables']").evaluateAll((els) => els.map((e) => e.value));
if (!ios.includes("利用者")) throw new Error(`CRUD の変更が入出力に入っていない: ${ios}`);
// 状態遷移
await shot("d4b-spec");
await page.locator(".react-flow__node-state").filter({ hasText: "確認中" }).scrollIntoViewIfNeeded();
await shot("d5-states");
// ⑩：構成図とコスト
await draft("s10");
await page.locator(".react-flow__node-res").filter({ hasText: "データベース" }).waitFor();
await page.getByText("月額の合計").waitFor();
await shot("d6-infra", true);

// ⑪：運用（監視・SLO・障害対応）
await draft("s11");
await page.getByText("S1（全面停止）").first().scrollIntoViewIfNeeded();
await shot("d7-ops");
// 資料の取り込み：資料を読み、工程の項目にあたる中身を案として出す
await page.goto(`${BASE}/p/${pid}/import`);
await page.getByLabel("取り込む資料").setInputFiles({
  name: "運用設計.md", mimeType: "text/markdown",
  buffer: Buffer.from("# 運用設計書\n## 監視項目\n| 対象 | 閾値 |\n|---|---|\n| DB | CPU 80% |\n## 設計方針\nコンテナで動かす"),
});
await btn("取り込む").click();
await page.getByText("完了", { exact: true }).first().waitFor({ timeout: 60000 });
await page.getByRole("link", { name: /工程を開いて案を選ぶ/ }).first().waitFor();
await shot("d8-import", true);
await page.getByRole("link", { name: /工程を開いて案を選ぶ/ }).first().click();
await page.getByText(/資料「運用設計.md」から 1 項目の案を作りました/).waitFor();
await shot("d9-import-proposals");
// 報告資料：⑨⑩を選び、AI の構成 → 直す → PowerPoint
await page.goto(`${BASE}/p/${pid}/reports`);
await page.getByLabel("⑨アプリケーション設計を使う").check();
await page.getByLabel("⑩インフラ設計を使う").check();
await page.getByLabel("報告資料の題").fill("設計レビュー");
await page.getByLabel("読み手").fill("開発チーム");
await btn("報告資料を作る").click();
await page.waitForURL(/\/reports\/\d+$/);
await page.getByLabel("スライド2の題").waitFor({ timeout: 60000 });
await page.getByLabel("スライド2の題").fill("設計は2つの処理から成る");
await btn("保存", true).click();
await btn("保存", true).and(page.locator(":disabled")).waitFor();
await page.getByText("付録の表").first().waitFor();
await shot("d10-report", true);
const [deck] = await Promise.all([page.waitForEvent("download"), btn("PowerPointに出力").click()]);
if (fs.statSync(await deck.path()).size < 10000) throw new Error("PowerPoint が小さすぎる");
console.log(`ok product=${pid}`);
await browser.close();
