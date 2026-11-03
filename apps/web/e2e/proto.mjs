// UI のプロトタイプ（画面の移り方まで操作できる1つの HTML）：画面の部品から「まとめる」→ 押して画面が移る・戻る
// → 部品にコメントして AI（設計PM）に送る → 一部を直す承認依頼 → 承認で直り「反映済み」
// → 「AI で作る」→ 設計PM の承認依頼 → 承認で入れ替わる → script を含む HTML を取り込んで動く
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/proto.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
page.setDefaultTimeout(30000);
page.on("dialog", (d) => d.accept());
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

// プロトタイプ：画面からまとめる → 押して移る・戻る
await page.getByRole("link", { name: "プロトタイプ", exact: true }).click();
await page.waitForURL(/mode=proto/);
const pr = page.getByLabel("プロトタイプ", { exact: true });
const fr = page.frameLocator('iframe[title="プロトタイプの画面"]');
await pr.getByRole("button", { name: "画面からまとめる" }).last().click();
await pr.getByText(/画面からまとめました/).waitFor();
await fr.getByText("今月の家計").waitFor();
await fr.getByRole("button", { name: "明細を見る" }).click();
await fr.getByText("明細の一覧").waitFor();
await fr.getByText("ホームへ戻る").click();
await fr.getByText("今月の家計").waitFor();
await fr.getByRole("button", { name: "← 前の画面" }).click();
await fr.getByText("明細の一覧").waitFor();
// 案内の画面の一覧（狭いときは選択欄）から飛ぶ
if (await fr.locator("#steps").isVisible()) await fr.locator("[data-jump]").first().click();
else await fr.getByLabel("画面へ移動").selectOption({ index: 0 });
await fr.getByText("今月の家計").waitFor();
await shot("p1-proto");

// コメント：部品を押す → AI に送る → 一部を直す承認依頼 → 承認で直り、反映済み
await pr.getByRole("button", { name: "コメント", exact: true }).click();
await fr.getByRole("button", { name: "明細を見る" }).click();
const pop = pr.getByRole("dialog", { name: "コメントを書く" });
await pop.getByText(/button「明細を見る」/).waitFor();
if (!(await fr.getByText("今月の家計").isVisible())) throw new Error("コメント中に画面が移った");
await pop.getByLabel("コメント").fill("このボタンをもっと大きく");
await pop.getByRole("button", { name: "送る" }).click();
await pr.getByText("AI に依頼中").waitFor();
await fr.locator(".pf-pin").first().waitFor();
await shot("p2-comment");
let card = page.getByRole("group", { name: /承認依頼：UI のプロトタイプを直す/ }).last();
await card.getByText("下見（変更後。押して動かせます）").waitFor();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await pr.getByText("反映済み").waitFor();
await fr.getByText(/（スタブ）修正/).waitFor();
await shot("p3-applied");
await pr.getByRole("button", { name: "コメント中" }).click();

// AI で作る → 設計PM の承認依頼 → 承認で入れ替わる（スタブは画面一覧から組む）
await pr.getByRole("tab", { name: "作る" }).click();
await pr.getByLabel("AI への注文").fill("スマホアプリとして");
await pr.getByRole("button", { name: "AI で作る" }).last().click();
card = page.getByRole("group", { name: /承認依頼：UI のプロトタイプを作り直す/ }).last();
await card.getByRole("button", { name: "承認", exact: true }).click({ timeout: 60000 });
await card.getByText(/承認しました/).waitFor();
await pr.getByText(/AI が書いたもの/).waitFor();
await fr.getByRole("button", { name: "次へ" }).waitFor();

// script を含む HTML を取り込む：その script が動き、押すと移る。外への通信は止める
await pr.getByRole("tab", { name: "作る" }).click();
await pr.getByLabel("貼り付ける HTML").fill(`<!doctype html><html><head><title>取込</title></head><body><div id="v"></div>
<script>let n=0;const r=()=>{document.getElementById('v').innerHTML='<h1>画面'+n+'</h1><button data-go="x">進む</button>'};
document.addEventListener('click',e=>{if(e.target.closest('[data-go]')){n++;r();}});r();
fetch('https://example.com/').then(()=>{document.title='leak'}).catch(()=>{document.body.dataset.blocked='1'});</script></body></html>`);
await pr.getByRole("button", { name: "貼り付けた HTML を取り込む" }).click();
await pr.getByText("取り込みました").waitFor();
await fr.getByText("画面0").waitFor();
await fr.getByRole("button", { name: "進む" }).click();
await fr.getByText("画面1").waitFor();
await fr.locator("body[data-blocked='1']").waitFor();
await pr.getByRole("button", { name: "HTML をダウンロード" }).waitFor();
console.log("proto e2e OK", pid);
await browser.close();
