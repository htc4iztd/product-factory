// ドキュメント：書く（DOC-n）と取り込む（Excel・Word・PowerPoint・テキスト）を1か所に。
// チケット・議論・決定記録・会議は廃止（レールにも出ない・ページもない）
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/docs.mjs
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
await page.fill("input[name=name]", "DOCS");
await page.fill("input[name=email]", `docs-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/new`);
for (const a of ["誰でも小説を書いて読めるアプリ", "書き手と読み手。続きを書く動機が続かない", "1日1話を書けば読まれる。MVP で"]) {
  await page.getByText("考えています…").waitFor({ state: "detached" });
  await page.getByLabel("返事").fill(a);
  await btn("送信", true).click();
}
await page.getByText("作れます", { exact: true }).waitFor();
await page.getByLabel("プロダクト名").fill("みんなのノベル");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// 廃止した機能はレールに出ない
const rail = page.getByRole("navigation", { name: "エージェント" });
for (const gone of ["チケット", "議論", "決定記録", "会議", "資料の取り込み"]) {
  if (await rail.getByRole("link", { name: gone, exact: true }).count()) throw new Error(`${gone} がレールに残っている`);
}
// 書く
await rail.getByRole("link", { name: "ドキュメント", exact: true }).click();
await page.waitForURL(/\/docs$/);
await page.getByLabel("または、新しく書く（Markdown）").fill("競合メモ");
await btn("書き始める").click();
await page.waitForURL(/docs\/1$/);
await page.getByLabel("本文（Markdown）").fill("# 競合\nUS-01 を踏まえて価格を比べる");
await btn("保存", true).first().click();
await page.getByText("保存しました").waitFor();
// 手で書いたドキュメントも、読んでいいエージェントを決められる（既定は全員）
const readers = page.getByLabel("読んでいいエージェント");
await readers.getByText("既定（全員）").waitFor();
await readers.getByRole("button", { name: "誰にも読ませない" }).click();
await readers.getByRole("button", { name: "事業PM" }).click();
await readers.getByRole("button", { name: "保存", exact: true }).click();
await readers.getByText("次に動くとき・話すときから読みます").waitFor();
await page.reload();
await page.getByLabel("読んでいいエージェント").getByText("割り当て済み・1人").waitFor();
await shot("docs-readers", true);
// 取り込む（同じページ）→ 一覧に書いたものと並ぶ
await page.goto(`${BASE}/p/${pid}/docs`);
await page.getByLabel("取り込む資料").setInputFiles({ name: "運用メモ.md", mimeType: "text/markdown", buffer: Buffer.from("# 監視\n申込の受付が5分止まったら通知する\n") });
await btn("取り込む").click();
await page.getByText("完了", { exact: true }).first().waitFor({ timeout: 60000 });
const list = page.getByLabel("ドキュメントの一覧");
await list.getByText("競合メモ").waitFor();
await list.getByText("運用メモ.md").waitFor();
await shot("docs1", true);
// 古い取り込みのページはドキュメントへ
await page.goto(`${BASE}/p/${pid}/import`);
await page.waitForURL(/\/docs$/);
// Issue の GitHub 同期は押したときだけ。リポジトリをつないでいなければ、つなぎ方を案内する
await page.goto(`${BASE}/p/${pid}/issues`);
await page.getByLabel("GitHub との同期").or(page.getByText("でリポジトリをつなぎます")).first().waitFor();
console.log(`ok product=${pid}`);
await browser.close();
