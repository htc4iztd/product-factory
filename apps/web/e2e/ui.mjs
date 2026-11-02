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
const canvas = page.frameLocator('iframe[title="UI のキャンバス"]');
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
await canvas.getByText("申込", { exact: true }).waitFor();
// クリックで部品を選ぶ → 右に「選んだ部品」
await canvas.getByText("申込", { exact: true }).click();
await ed.getByRole("navigation", { name: "部品の位置" }).waitFor();
// ダブルクリックで文字を直接書き換える
await canvas.getByText("申込", { exact: true }).dblclick();
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("お申し込み");
await page.keyboard.press("Escape");
await canvas.getByText("お申し込み", { exact: true }).waitFor();
await ed.getByText("保存していない変更があります").waitFor();
// 部品を足す → 元に戻す
await ed.getByRole("tab", { name: "部品を足す" }).click();
await ed.getByRole("button", { name: "数値カード（3つ）" }).click();
await canvas.getByText("今月の支出").waitFor();
await ed.getByRole("button", { name: "元に戻す" }).click();
await canvas.getByText("お申し込み", { exact: true }).waitFor();
if (await canvas.getByText("今月の支出").count()) throw new Error("元に戻せていない");
// 選んだ部品の見た目（角丸・背景）と、クラスの切り替え
await canvas.getByText("お申し込み", { exact: true }).click();
await ed.getByLabel("背景").fill("#eef2ff");
await ed.getByLabel("背景").press("Tab");
await ed.getByRole("button", { name: "複製" }).click();
if ((await canvas.getByText("お申し込み", { exact: true }).count()) !== 2) throw new Error("複製できていない");
await ed.getByRole("button", { name: "部品を消す" }).click();
await shot("u2-select");
// 表示の幅を切り替える（スマホは 390px）
await ed.getByRole("button", { name: "スマホ" }).click();
await page.waitForFunction(() => document.querySelector('iframe[title="UI のキャンバス"]')?.style.width === "390px");
await ed.getByRole("button", { name: "PC" }).click();
// コードを直接書く
await ed.getByRole("tab", { name: "コード" }).click();
await ed.getByLabel("CSS").fill("h1{color:#7c3aed}");
await ed.getByRole("button", { name: "キャンバスに反映" }).click();
await canvas.getByText("お申し込み", { exact: true }).waitFor();
// 既存の HTML を取り込む（貼り付け）：body と style を取り込み、スクリプトは外す
await ed.getByRole("button", { name: "HTML を取り込む" }).click();
await ed.getByLabel("貼り付ける HTML").fill('<html><head><title>料金</title><style>.price{color:#059669}</style><script>alert(1)</script></head><body><main class="pf-main"><h1 class="price">料金プラン</h1><button onclick="alert(2)">選ぶ</button></main></body></html>');
await ed.getByRole("button", { name: "貼り付けた HTML を取り込む" }).click();
await ed.getByRole("button", { name: /料金/ }).first().waitFor();
await canvas.getByText("料金プラン").waitFor();
await ed.getByText(/スクリプトなど動くもの（1 件）は外しました/).waitFor();
if (await canvas.locator("[onclick]").count()) throw new Error("onclick が残っている");
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
