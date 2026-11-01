// プラットフォーム：レールの状態が数秒ごとに更新される → プラットフォームの画面（稼働状況・問題・対話）
// → ⌘K からプラットフォームに話す
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/platform.mjs
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
await page.fill("input[name=name]", "PLT");
await page.fill("input[name=email]", `plt-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("見張りの家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// レール：状態の更新時刻が数秒ごとに進む（どのページでも）
const live = page.getByRole("status", { name: "エージェントのライブ表示" });
await live.getByText(/状態の更新 \d\d:\d\d:\d\d/).waitFor({ timeout: 15000 });
const t1 = await live.innerText();
await page.waitForTimeout(6500);
const t2 = await live.innerText();
if (t1 === t2) throw new Error(`レールの状態が更新されない: ${t1}`);
await page.getByText(/定期実行 (1分以内|\d+分前)|定期実行：記録なし/).first().waitFor();
await shot("p1-rail");

// プラットフォームの画面：レールから入る
await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: /プラットフォーム/ }).click();
await page.waitForURL(/\/platform$/);
await page.getByRole("region", { name: "稼働状況" }).waitFor();
await page.getByRole("region", { name: "稼働の問題" }).waitFor();
await page.getByRole("region", { name: "プロダクトごとのエージェント" }).getByRole("link", { name: "見張りの家計簿" }).waitFor();
// 定期実行が来ていなければ、承認して1回動かせる
const tickFix = page.getByRole("button", { name: /承認して実行：いま1回、定期実行を動かす/ });
if (await tickFix.count()) {
  await tickFix.first().click();
  await page.getByText(/定期実行を1回動かしました/).first().waitFor();
}
// 対話：PdM が直接話す
await btn("いま全体はちゃんと動いてる？").click();
await page.getByRole("region", { name: "プラットフォームとの対話" }).getByText(/（スタブ）(未解決の問題は|いま見つかっている問題はありません)/).last().waitFor();
await shot("p2-platform", true);

// ⌘K：@プラットフォーム で話す
await page.keyboard.press("Control+k");
await page.getByLabel("話しかける・移動する").last().fill("@プラットフォーム 失敗しているジョブはある？");
await page.getByRole("option", { name: /プラットフォームに話す/ }).click();
await page.getByText(/プラットフォームが答えました/).waitFor();
await shot("p3-command");
console.log(`ok product=${pid}`);
await browser.close();
