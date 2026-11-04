// チャットの手ざわり：送るとすぐ自分の発言が出て入力欄が空になる → 答える人と、していること（手順）が出る
// → 返事の文章が流れて出る（カーソル付き）→ 終わると残った発言に置き換わり、Markdown で出る → 失敗は入力欄に戻す
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/chat.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "CHAT");
await page.fill("input[name=email]", `chat-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("話す家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

const chat = page.getByLabel("チャット", { exact: true });
const box = page.getByLabel("チャットに話す");
await box.fill("いまの状況を教えて");
const t0 = Date.now();
await btn("チャットを送る").click();
// すぐ：自分の発言が出て、入力欄は空。返事を書いている途中の表示
await chat.getByText("いまの状況を教えて").first().waitFor({ timeout: 1500 });
if ((await box.inputValue()) !== "") throw new Error("入力欄が空になっていない");
const live = chat.getByLabel("返事を書いています");
await live.waitFor({ timeout: 3000 });
console.log("自分の発言が出るまで", Date.now() - t0, "ms");
await live.getByText(/事業PM|設計PM|実装PM|プラットフォーム/).first().waitFor();
await live.getByText(/中身を読んでいます/).first().waitFor({ state: "attached" });  // 返事が流れ始めると手順はたたむ
await live.locator(".pf-caret").waitFor();
await shot("c1-streaming");
// 終わると残った発言に置き換わる（途中の表示は消える）
await live.waitFor({ state: "detached" });
const last = chat.locator("[data-msg]").last();
await last.getByText(/承りました/).waitFor();
if ((await chat.getByText("いまの状況を教えて").count()) !== 1) throw new Error("自分の発言が二重に出ている");
await shot("c2-done");
// 送れなかったら、入力欄に戻してわけを出す（存在しない添付）
await page.route("**/api/assistant/stream", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "添付が見つかりません" }) }));
await box.fill("もう一度");
await btn("チャットを送る").click();
await chat.getByText("添付が見つかりません").waitFor();
if ((await box.inputValue()) !== "もう一度") throw new Error("入力欄に戻っていない");
// 途中で切れた（答えが来ないまま流れが終わった）ら、書いている表示を止めて、わけを出す（待ち続けない）
await page.unroute("**/api/assistant/stream");
await page.route("**/api/assistant/stream", (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson",
  body: JSON.stringify({ type: "route", agent: "pm_biz", agent_name: "事業PM" }) + "\n" + JSON.stringify({ type: "step", text: "返事を書いています" }) + "\n" }));
await box.fill("切れる発言");
await btn("チャットを送る").click();
await chat.getByText(/途中で切れました/).waitFor();
if (await chat.getByLabel("返事を書いています").count()) throw new Error("書いている表示が残っている");
console.log("chat e2e OK", pid);
await browser.close();
