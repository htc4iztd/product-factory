// スマホ専用の UI：同じ URL のままスマホの骨組み（チャット｜承認｜進捗＋常設の入力欄）になる
// → 話す → 進捗から工程を全画面で読み、その工程について話す（チャットが下から出る）→ 話題の切り替え
// → メニューから UI のプロトタイプ → AI で作る → 承認タブで承認 → 触る・部品にコメントして AI に送る
// → PC 向けの画面は PC 版へ → PC 版からスマホ版に戻す。横にはみ出さない
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/mobile.mjs
import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
// PC でユーザーとプロダクトを作る（スマホではプロダクトの作成は PC 版）
const pc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const d = await pc.newPage();
d.setDefaultTimeout(30000);
await d.goto(`${BASE}/register`);
await d.fill("input[name=name]", "SP");
await d.fill("input[name=email]", `sp-${Date.now()}@example.com`);
await d.fill("input[name=password]", "password123");
await d.getByRole("button", { name: "登録して始める" }).click();
await d.waitForURL(`${BASE}/`);
await d.goto(`${BASE}/new`);
for (const a of ["共働き世帯の家計簿アプリ", "共働きの夫婦。締め処理に時間がかかる", "レシートを撮るだけで締めまで終わる。MVP で"]) {
  await d.getByText("考えています…").waitFor({ state: "detached" });
  await d.getByLabel("返事").fill(a);
  await d.getByRole("button", { name: "送信", exact: true }).click();
}
await d.getByText("作れます", { exact: true }).waitFor();
await d.getByLabel("プロダクト名").fill("スマホの家計簿");
await d.getByRole("button", { name: "この内容でプロダクトをつくる" }).click();
await d.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = d.url().split("/p/")[1];
const state = await pc.storageState();

const ctx = await browser.newContext({ ...devices["iPhone 13"], storageState: state });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (w > 1) throw new Error(`${where}：横に ${w}px はみ出している`);
};

// ファクトリー全体：チャット｜承認｜プロダクト。プロダクトを開く
await page.goto(`${BASE}/`);
await page.locator("[data-mobile]").waitFor();
await page.getByRole("tab", { name: "プロダクト" }).click();
await page.getByRole("link", { name: /スマホの家計簿/ }).click();
await page.waitForURL(new RegExp(`/p/${pid}$`));
if (!page.url().endsWith(`/p/${pid}`)) throw new Error("URL が変わった");
await page.getByRole("tab", { name: "チャット" }).waitFor();
await page.getByLabel("話題：プロダクト全体").waitFor();
await noOverflow("プロダクトのホーム");
// 話す（入力欄は下に常にある）
await page.getByLabel("チャットに話す").fill("いまの状況を教えて");
await page.getByRole("button", { name: "チャットを送る" }).click();
await page.getByText("いまの状況を教えて").first().waitFor();
await page.locator("[data-msg]").filter({ hasNot: page.getByText("いまの状況を教えて") }).last().waitFor();
await shot("m1-home");

// 進捗 → 工程を全画面で読む → その工程について話す（チャットが下から出る）
await page.getByRole("tab", { name: "進捗" }).click();
await page.getByRole("link", { name: /① アイディエーション/ }).click();
await page.waitForURL(new RegExp(`/p/${pid}/s/s01$`));
await page.getByLabel("話題：①アイディエーション").waitFor();
await noOverflow("工程");
await shot("m2-stage");
await page.getByLabel("チャットに話す").fill("この工程の要点は？");
await page.getByRole("button", { name: "チャットを送る" }).click();
const sheet = page.getByRole("dialog", { name: "チャット" });
await sheet.getByText("この工程の要点は？").waitFor();
await shot("m3-sheet");
await sheet.getByRole("button", { name: "チャットを閉じる" }).click();
// 話題の切り替え
await page.getByLabel("話題：①アイディエーション").click();
await page.getByRole("option", { name: "プロダクト全体" }).click();
await page.getByLabel("話題：プロダクト全体").waitFor();

// メニュー → UI のプロトタイプ → AI で作る → 承認タブで承認
await page.getByRole("button", { name: "メニューを開く" }).click();
await page.getByRole("navigation", { name: "メニュー" }).getByRole("link", { name: "UI のプロトタイプ" }).click();
await page.waitForURL(new RegExp(`/p/${pid}/s/s06/ui$`));
await page.getByRole("button", { name: "AI で作る" }).click();
await page.getByText(/AI が書いています/).waitFor();
await page.getByRole("link", { name: /承認待ち/ }).click({ timeout: 60000 });
await page.waitForURL(/tab=approve/);
const card = page.getByRole("group", { name: /承認依頼：UI のプロトタイプを作る/ }).last();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await shot("m4-approve");
// 触る・部品にコメントして AI に送る
await page.goto(`${BASE}/p/${pid}/s/s06/ui`);
const fr = page.frameLocator('iframe[title="プロトタイプの画面"]');
await fr.getByRole("button", { name: "次へ" }).click();
await page.getByRole("button", { name: "コメント", exact: true }).click();
await fr.getByRole("button", { name: "次へ" }).click();
const cs = page.getByRole("dialog", { name: "コメントを書く" });
await cs.getByLabel("コメント").fill("ボタンを大きく");
await cs.getByRole("button", { name: "送る" }).click();
await page.getByText(/AI に送りました/).waitFor();
await noOverflow("プロトタイプ");
await shot("m5-proto");

// PC 向けの画面 → PC 版で開く → スマホ版に戻す
await page.goto(`${BASE}/p/${pid}/board`);
await page.getByText("PC 向けの画面です").waitFor();
await page.getByRole("button", { name: "PC 版で開く" }).last().click();
// PC 版の中身はチャットが数秒ごとに描き直すので、固定のボタンは force で押す
await page.getByRole("button", { name: "スマホ版に戻す" }).waitFor({ state: "attached" });
await page.getByRole("button", { name: "スマホ版に戻す" }).click({ force: true });
await page.getByText("PC 向けの画面です").waitFor();
console.log("mobile e2e OK", pid);
await browser.close();
