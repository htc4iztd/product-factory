// ⑥の UI はプロトタイプ（画面の移り方まで操作できる1つの HTML）だけ：⑥から開く →「AI で作る」→ 設計PM の承認依頼
// → 承認で入る → 押して画面が移る・戻る → 部品にコメントして AI に送る → 一部を直す承認依頼 → 承認で直り「反映済み」
// → script を含む HTML を取り込んで動き、外への通信は止まる → ⑥の工程に下見が出る
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

// ⑥から開く → AI で作る → 設計PM の承認依頼 → 承認で入る
await page.goto(`${BASE}/p/${pid}/s/s06`);
await page.getByRole("link", { name: "プロトタイプを開く" }).first().click();
await page.waitForURL(/\/s\/s06\/ui/);
const pr = page.getByLabel("プロトタイプ", { exact: true });
const fr = page.frameLocator('iframe[title="プロトタイプの画面"]');
if (await page.getByRole("link", { name: "画面の部品" }).count()) throw new Error("画面の部品のタブが残っている");
await pr.getByLabel("AI への注文").fill("スマホアプリとして");
await pr.getByRole("button", { name: "AI で作る" }).last().click();
let card = page.getByRole("group", { name: /承認依頼：UI のプロトタイプを作る/ }).last();
await card.getByRole("button", { name: "承認", exact: true }).click({ timeout: 60000 });
await card.getByText(/承認しました/).waitFor();
await pr.getByText(/AI が書いたもの/).waitFor();
// 押して移る・戻る
await fr.locator("#view").getByRole("heading", { name: "ホーム" }).waitFor();
await fr.getByRole("button", { name: "次へ" }).click();
await fr.locator("#view").getByRole("heading", { name: "詳細" }).waitFor();
await fr.getByRole("button", { name: "前の画面へ" }).click();
await fr.locator("#view").getByRole("heading", { name: "ホーム" }).waitFor();
await shot("p1-proto");

// コメント：部品を押す → AI に送る → 一部を直す承認依頼 → 承認で直り、反映済み
await pr.getByRole("button", { name: "コメント", exact: true }).click();
await fr.getByRole("button", { name: "次へ" }).click();
const pop = pr.getByRole("dialog", { name: "コメントを書く" });
await pop.getByText(/button「次へ」/).waitFor();
if (!(await fr.locator("#view").getByRole("heading", { name: "ホーム" }).isVisible())) throw new Error("コメント中に画面が移った");
await pop.getByLabel("コメント").fill("このボタンをもっと大きく");
await pop.getByRole("button", { name: "送る" }).click();
await pr.getByText("AI に依頼中").waitFor();
await fr.locator(".pf-pin").first().waitFor();
await shot("p2-comment");
card = page.getByRole("group", { name: /承認依頼：UI のプロトタイプを直す/ }).last();
await card.getByText("下見（変更後。押して動かせます）").waitFor();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await pr.getByText("反映済み").waitFor();
await fr.getByText(/（スタブ）修正/).waitFor();
await shot("p3-applied");
await pr.getByRole("button", { name: "コメント中" }).click();

// チャットに HTML を添付して「プロトタイプにして」→ 添付の HTML をそのままプロトタイプにする承認依頼 → 承認で入る
await page.getByLabel("添付するファイル").setInputFiles({ name: "mock.html", mimeType: "text/html",
  buffer: Buffer.from('<!doctype html><html><body><h1>添付した見本</h1><button data-go="x">押す</button></body></html>') });
await page.getByText("mock.html").first().waitFor();
await page.getByLabel("チャットに話す").fill("この HTML をプロトタイプにして");
await page.getByRole("button", { name: "チャットを送る" }).click();
card = page.getByRole("group", { name: /承認依頼：添付の HTML「mock.html」を UI のプロトタイプにする/ }).last();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await fr.getByText("添付した見本").waitFor();

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
// 中身が広い HTML でも切れない：中身の幅で描いて全体を縮める → 100%（横に送る）→ 大きく見る（Esc で戻る）→ 右の欄をたたむ
await pr.getByRole("tab", { name: "作る" }).click();
await pr.getByLabel("貼り付ける HTML").fill('<!doctype html><html><body style="margin:0"><div style="display:flex;min-width:1600px"><aside style="width:300px">案内</aside><main style="width:1300px;text-align:right">右の端</main></div></body></html>');
await pr.getByRole("button", { name: "貼り付けた HTML を取り込む" }).click();
await fr.getByText("右の端").waitFor();
const frameEl = page.locator('iframe[title="プロトタイプの画面"]');
await page.waitForFunction(() => parseInt(document.querySelector('iframe[title="プロトタイプの画面"]').style.width) >= 1600);
const box = await frameEl.boundingBox();
const areaBox = await frameEl.locator("xpath=../..").boundingBox();
if (box.width > areaBox.width + 2) throw new Error(`収めていない：${box.width} > ${areaBox.width}`);
await pr.getByRole("button", { name: "そのままの大きさ（はみ出したら横に送る）" }).click();
await page.waitForFunction(() => document.querySelector('iframe[title="プロトタイプの画面"]').style.transform === "scale(1)");
await pr.getByRole("button", { name: "全体が収まるよう縮める" }).click();
await pr.getByRole("button", { name: "右の欄を閉じる" }).click();
if (await page.getByLabel("プロトタイプの操作").count()) throw new Error("右の欄が閉じていない");
await pr.getByRole("button", { name: "右の欄を開く" }).click();
await pr.getByRole("button", { name: "大きく見る" }).click();
const big = page.getByLabel("プロトタイプを大きく見る");
await big.waitFor();
const bb = await big.boundingBox();
if (bb.width < 1400) throw new Error("画面いっぱいになっていない");
await shot("p4-full");
await page.keyboard.press("Escape");
await big.waitFor({ state: "detached" });

// ⑥の工程に下見が出る
await page.goto(`${BASE}/p/${pid}/s/s06`);
await page.locator('iframe[title="UI のプロトタイプの下見"]').waitFor();
console.log("proto e2e OK", pid);
await browser.close();
