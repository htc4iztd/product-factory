// UI のプロトタイプ：画面を通しで見る → ボタン（data-go）・リンクで画面が移る・戻る
// → コメントのモードで部品を押してコメント → AI（設計PM）に送る → チャットに書き換えの承認依頼 → 承認 → 画面が直り、コメントは「反映済み」
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/proto.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
page.setDefaultTimeout(30000);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "PROTO");
await page.fill("input[name=email]", `proto-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("通しの家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// 編集で2画面を取り込む（ホーム → data-go で一覧へ、一覧 → リンクでホームへ）
await page.goto(`${BASE}/p/${pid}/s/s06/ui?mode=edit`);
const ed = page.getByLabel("UI エディタ");
for (const html of [
  '<html><head><title>ホーム</title></head><body><main class="pf-main"><h1>今月の家計</h1><button class="pf-btn" data-go="一覧">明細を見る</button></main></body></html>',
  '<html><head><title>一覧</title></head><body><main class="pf-main"><h1>明細の一覧</h1><a href="ホーム.html">ホームへ戻る</a></main></body></html>',
]) {
  await ed.getByRole("button", { name: "HTML を取り込む" }).click();
  await ed.getByLabel("貼り付ける HTML").fill(html);
  await ed.getByRole("button", { name: "貼り付けた HTML を取り込む" }).click();
}
await ed.getByRole("button", { name: "保存" }).click();
await ed.getByText("保存しました").waitFor();

// プロトタイプ：押して移る・戻る
await page.getByRole("link", { name: "プロトタイプ", exact: true }).click();
await page.waitForURL(/mode=proto/);
const pr = page.getByLabel("プロトタイプ", { exact: true });
const fr = page.frameLocator('iframe[title="プロトタイプの画面"]');
await pr.getByRole("button", { name: "ホーム" }).click();
await fr.getByText("今月の家計").waitFor();
await pr.getByLabel("設計メモ").getByRole("button", { name: /明細を見る → 一覧/ }).waitFor();
await fr.getByText("明細を見る").click();
await fr.getByText("明細の一覧").waitFor();
if (!(await pr.getByLabel("いまの画面").textContent()).includes("一覧")) throw new Error("一覧に移っていない");
await fr.getByText("ホームへ戻る").click();
await fr.getByText("今月の家計").waitFor();
await pr.getByRole("button", { name: "前の画面に戻る" }).click();
await fr.getByText("明細の一覧").waitFor();
await pr.getByRole("button", { name: "前の画面に戻る" }).click();
await fr.getByText("今月の家計").waitFor();
await shot("p1-proto");

// コメント：部品を押す → コメントを書いて AI に送る
await pr.getByRole("button", { name: "コメント" }).click();
await fr.getByText("明細を見る").click();
const pop = pr.getByRole("dialog", { name: "コメントを書く" });
await pop.getByText(/ボタン「明細を見る」/).waitFor();
await pop.getByLabel("コメント").fill("このボタンをもっと大きく");
await pop.getByRole("button", { name: "送る" }).click();
await pr.getByText("AI に依頼中").waitFor();
if ((await fr.locator(".pf-pin").count()) !== 1) throw new Error("ピンが出ていない");
// 押しても画面は移らない（コメント中）
if (!(await pr.getByLabel("いまの画面").textContent()).includes("ホーム")) throw new Error("コメント中に移ってしまった");
await shot("p2-comment");

// チャットに書き換えの承認依頼 → 承認 → 画面が直り、コメントは反映済み
const card = page.getByRole("group", { name: /承認依頼：UI デザイン「ホーム」を書き換える/ }).last();
await card.getByText("下見（変更後）").waitFor();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await pr.getByText("反映済み").waitFor();
await fr.getByText(/（スタブ）修正/).waitFor();
await fr.getByRole("button", { name: "明細を見る" }).waitFor();
await shot("p3-applied");

// 解決にすると、ピンが消える
await pr.getByRole("button", { name: "解決" }).click();
await pr.getByText("解決", { exact: true }).waitFor();
await page.waitForFunction(() => !document.querySelector('iframe[title="プロトタイプの画面"]')?.contentDocument?.querySelector(".pf-pin"));
console.log("proto e2e OK", pid);
await browser.close();
