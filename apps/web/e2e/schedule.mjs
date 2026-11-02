// スケジュール：cron を書かずに選ぶ → 読み方と次の3回 → 事業の担当をまとめて30分ごと → 時間割に出る
// → 止める → すべてのプロダクトの予定 → 見回りの間隔。定時の状況確認は担当全員が返事をする
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/schedule.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(30000);
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "SCH");
await page.fill("input[name=email]", `sch-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("予定の家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: "スケジュール" }).click();
await page.waitForURL(/\/schedule$/);
const grid = page.getByRole("region", { name: "時間割" });
const row = (k) => grid.locator(`[data-key="${k}"]`);
await row("s01").getByText("10分ごと").waitFor();
await row("pm_biz").getByText("毎時 0分").waitFor();
if (await row("meeting").count()) throw new Error("振り返りの会議の予定が残っている");
await row("pm_sync").getByText("10分ごと（5分から）").waitFor(); // PM 同士の連絡も定期実行
// 事業の担当をまとめて選び、「◯時間ごと」→ 曜日を選ぶ に切り替えて読み方を確かめ、30分ごとにする
await page.getByLabel("事業の担当（①〜⑤）をまとめて選ぶ").check();
const box = page.getByRole("region", { name: "予定を変える" });
await box.getByLabel("選んだエージェントの予定の決め方").selectOption("weekly");
await page.getByRole("button", { name: "水", exact: true }).click();
await box.getByLabel("選んだエージェントの予定の時刻").fill("09:30");
await box.getByText(/毎週月・水曜 9:30・次：/).waitFor();
await box.getByLabel("選んだエージェントの予定の決め方").selectOption("every");
await box.getByLabel("選んだエージェントの予定の間隔（分）").selectOption("30");
await box.getByText(/30分ごと・次：/).waitFor();
await btn("この予定にする").click();
await page.getByText("5 人の予定を変えました").waitFor();
await row("s03").getByText("30分ごと").waitFor();
await row("s06").getByText("10分ごと").waitFor();
// ⑭を止める
await page.getByLabel("事業の担当（①〜⑤）をまとめて選ぶ").uncheck();
await page.getByLabel("⑭リリース担当を選ぶ").check();
await btn("止める").click();
await row("s14").getByText("止めています").waitFor();
// 見回りの間隔
await page.getByLabel("プラットフォームの見回りの間隔").selectOption("15");
await page.getByText(/変えました/).waitFor();
await grid.getByText("15分ごと").waitFor();
// すべてのプロダクトの予定
const all = page.getByRole("region", { name: "すべてのプロダクトの予定" });
await all.getByRole("link", { name: "予定の家計簿" }).waitFor();
await all.getByText("止めている 1 / 1").waitFor(); // ⑭はリリースエージェント（サイクルの外）として別の欄
await shot("s1-schedule", true);

// 組織の画面の設定も、cron を書かずに選ぶ
await page.goto(`${BASE}/p/${pid}/team`);
await btn("事業PMの設定").click();
await page.getByLabel("事業PMの決め方").waitFor();
await page.getByText(/毎時 0分・次：/).first().waitFor();

// 定時の状況確認：事業 PM を動かすと、①〜⑤の担当が全員返事をする
await page.getByRole("button", { name: "事業PMを今すぐ動かす" }).click();
await page.goto(`${BASE}/p/${pid}/board`);
for (let i = 0; i < 20 && !(await page.getByText(/全員（5人）から返事をもらいました/).count()); i++) { await page.waitForTimeout(1000); await page.reload(); }
const thread = page.getByRole("article").filter({ hasText: "全員（5人）から返事をもらいました" }).first();
for (const n of ["①アイディエーション担当", "②市場分析担当", "③競合分析担当", "④プロダクト戦略担当", "⑤事業計画書担当"]) {
  await thread.getByText(n).first().waitFor();
}
await shot("s2-board", true);
console.log(`ok product=${pid}`);
await browser.close();
