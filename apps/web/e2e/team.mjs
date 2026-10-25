// チーム：議論 → 決定と宿題の抜き出し → 決定の確定（ステージの参照に出る）→ チケット → 会議の議事録 → ドキュメント → 外部の会話の取り込み
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/team.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(20000);

// 新しいプロダクトは AI の聞き取りで作る（スタブは3つ答えると作れる）
async function createProduct(name, idea) {
  await page.goto(`${BASE}/new`);
  for (const a of [idea, "共働きの夫婦。月末の締めに時間がかかる", "レシートを撮るだけで記録する。まずは MVP で"]) {
    await page.getByText("考えています…").waitFor({ state: "detached" });
    await page.getByLabel("返事").fill(a);
    await page.getByRole("button", { name: "送信", exact: true }).click();
  }
  await page.getByText("作れます", { exact: true }).waitFor();
  await page.getByLabel("プロダクト名").fill(name);
  await page.getByRole("button", { name: "この内容でプロダクトをつくる" }).click();
  await page.waitForURL(/\/p\/[0-9a-f]+$/);
}
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "Team");
await page.fill("input[name=email]", `team-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await createProduct("みんなのノベル", "誰でも小説を書いて読めるアプリ");
const pid = page.url().split("/p/")[1];

// 議論：発言 → スレッドで返信 → AI が決定と宿題を抜き出す
await page.getByRole("link", { name: "議論" }).click();
await page.getByRole("heading", { name: "#全体" }).waitFor();
await page.getByLabel("発言").fill("投稿の上限はどうする？ US-01 に関係");
await btn("送信", true).click();
await page.getByText("投稿の上限はどうする？").waitFor();
await page.getByRole("link", { name: "スレッドで返信" }).click();
const thread = page.getByRole("complementary", { name: "スレッド" });
await thread.getByLabel("返信").fill("決定：1日の投稿は3話まで（US-01）");
await thread.getByRole("button", { name: "返信", exact: true }).click();
await thread.getByText("決定：1日の投稿は3話まで").waitFor();
await thread.getByLabel("返信").fill("宿題：上限に達したときの文言を考える");
await thread.getByRole("button", { name: "返信", exact: true }).click();
await thread.getByText("宿題：上限に達したときの文言を考える").waitFor();
await btn("決定と宿題を抜き出す").click();
await page.getByText("決定 1件・宿題 1件").waitFor();
await thread.getByText("DEC-1").waitFor();
await shot("t1-talk");

// 決定記録：確定（⑥に結び付け、反映するチケットを作る）
await page.getByRole("link", { name: "決定記録" }).first().click();
const card = page.locator("article#DEC-1");
await card.getByText("1日の投稿は3話まで").waitFor();
await card.getByLabel("関係するステージ").selectOption("s06");
await card.getByLabel("反映するチケットを作る").check();
await card.getByRole("button", { name: "確定する" }).click();
await page.getByRole("region", { name: "記録済み" }).getByText("1日の投稿は3話まで").waitFor();
await shot("t2-decisions", true);

// ⑥の参照タブに決定記録が出る
await page.goto(`${BASE}/p/${pid}/s/s06`);
await btn("参照タブ").click();
await btn(/決定記録（1）/).click();
await page.getByText("DEC-1 1日の投稿は3話まで").waitFor();
await shot("t3-stage-ref");

// チケット：抜き出した宿題（仕分け待ち）と、決定から作ったチケット
await page.goto(`${BASE}/p/${pid}/tickets`);
await page.getByRole("region", { name: "仕分け待ち" }).getByText("上限に達したときの文言を考える").waitFor();
await page.getByRole("region", { name: "未着手" }).getByText(/DEC-1 を反映/).click();
await page.getByLabel("状態").selectOption("doing");
await page.getByText("保存中…").waitFor({ state: "detached" });
await page.getByLabel("コメントを書く").fill("着手します。DEC-1 に沿って US-01 を直す");
await btn("コメントする").click();
await page.getByText("着手します。").waitFor();
await page.goto(`${BASE}/p/${pid}/tickets`);
await page.getByRole("region", { name: "進行中" }).getByText(/DEC-1 を反映/).waitFor();
await shot("t4-tickets");

// 会議：文字起こしから議事録
await page.getByRole("link", { name: "会議" }).click();
await page.getByLabel("会議名").fill("週次定例");
await btn("作成", true).click();
await page.waitForURL(/meetings\/1$/);
await page.getByLabel("文字起こし（会話の記録）").fill("田中: 有料プランは？\n佐藤: 決定：有料プランは月額480円\n佐藤: 宿題：決済会社を比べる（sato@example.com）");
await btn("保存して議事録を作る").click();
await page.getByRole("region", { name: "議事録" }).getByText("DEC-2 有料プランは月額480円").waitFor();
await shot("t5-meeting", true);

// ドキュメント
await page.getByRole("link", { name: "ドキュメント" }).click();
await page.getByLabel("新しいドキュメントのタイトル").fill("競合メモ");
await btn("作成", true).click();
await page.waitForURL(/docs\/1$/);
await page.getByLabel("本文（Markdown）").fill("# 競合\nDEC-2 を踏まえて価格を比べる");
await btn("保存", true).click();
await page.getByText("保存しました").waitFor();

// 外部の会話（Teams・要約だけ残す）を貼り付けて取り込む
await page.goto(`${BASE}/p/${pid}/talk?new=1`);
await page.getByLabel("名前").fill("teams-営業");
await page.getByLabel("つなぐ先").selectOption("teams");
await btn("作成", true).click();
await page.getByRole("heading", { name: "#teams-営業" }).waitFor();
await page.getByText("Microsoft Teams の会話を貼り付けて取り込む").click();
await page.getByLabel("取り込む会話").fill("山田: 法人向けは要る？\n鈴木: 決定：法人向けは来年度");
await btn("取り込む").click();
await page.getByText("Microsoft Teams の会話の要約").waitFor();
await shot("t6-external");
await page.goto(`${BASE}/p/${pid}/decisions`);
await page.locator("article#DEC-3").getByText("法人向けは来年度").waitFor();
console.log(JSON.stringify({ pid, ok: true }));
await browser.close();
