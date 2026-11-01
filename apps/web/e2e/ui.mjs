// UI デザイン：⑥から UI エディタ（GrapesJS）を開く → チャットで「申込画面を作って」→ 下見つきの承認依頼 → 承認 → エディタに反映
// → 手で画面を足して保存 → ⑥に下見が並ぶ
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/ui.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
page.setDefaultTimeout(30000);
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "UI");
await page.fill("input[name=email]", `ui-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("画面の家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

await page.goto(`${BASE}/p/${pid}/s/s06`);
await page.getByRole("link", { name: "UI エディタを開く" }).click();
await page.waitForURL(/\/s\/s06\/ui$/);
const ed = page.getByLabel("UI エディタ");
await page.locator(".gjs-cv-canvas").waitFor();
await page.getByText("答える人：設計PM").waitFor();
// チャットで頼む → 下見つきの承認依頼 → 承認すると、エディタの画面一覧に入る
await page.getByLabel("チャットに話す").fill("申込画面を作って");
await page.getByLabel("チャットに話す").press("Enter");
const card = page.getByRole("group", { name: /承認依頼：UI デザイン「申込」を作る/ }).last();
await card.getByText("下見（変更後）").waitFor();
await shot("u1-proposal");
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await ed.getByRole("button", { name: /申込/ }).waitFor();
await page.frameLocator(".gjs-frame").getByText("申込", { exact: true }).waitFor();
// 表示の幅を切り替える（スマホは 375px）
await ed.getByText("スマホ", { exact: true }).click();
await page.waitForFunction(() => Math.round(document.querySelector(".gjs-frame")?.getBoundingClientRect().width ?? 0) === 375);
await ed.getByText("PC", { exact: true }).click();
// 手で画面を足して保存
await ed.getByRole("button", { name: "画面を足す" }).click();
await ed.getByLabel("画面名").fill("一覧");
await ed.getByRole("button", { name: "保存" }).click();
await ed.getByText("保存しました").waitFor();
await shot("u2-editor");
// ⑥に下見が並ぶ
await page.goto(`${BASE}/p/${pid}/s/s06`);
await page.getByRole("link", { name: /申込/ }).first().waitFor();
await page.getByRole("link", { name: /一覧/ }).first().waitFor();
console.log(`ok product=${pid}`);
await browser.close();
