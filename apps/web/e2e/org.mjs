// エージェントの組織：PdM は PM とだけ話す → PM が担当に Issue → 担当が実行して工程に書き込み、結果を返す
// → PM の作業場所・掲示板（エージェント同士・読むだけ）・振り返りの会議・レールと ⌘K・添付・顔
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/org.mjs
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
await page.fill("input[name=name]", "ORG");
await page.fill("input[name=email]", `org-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("ふたりの家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// ダッシュボード：3人の PM と14の担当。事業 PM に話す → ①の担当に Issue
await page.getByRole("region", { name: "PM との対話" }).waitFor();
await page.locator(".react-flow__node-agent").filter({ hasText: "事業PM" }).waitFor();
await page.getByLabel("事業PMへの発言").fill("①の下書きを作って。対象は共働き世帯");
await btn("話す", true).click();
await page.getByRole("link", { name: "#1" }).first().waitFor({ timeout: 30000 });
await shot("o1-dashboard");
// Issue：担当が実行して工程に書き込み、PM に返し、PM が確かめて終了にする（記録が残る）
await page.goto(`${BASE}/p/${pid}/issues/1`);
for (let i = 0; i < 40 && !(await page.getByText("終了", { exact: true }).first().isVisible()); i++) { await page.waitForTimeout(1000); await page.reload(); }
await page.getByText(/工程の下書きに書き込んだ項目/).first().waitFor();
await shot("o2-issue", true);
await page.getByText(/この Issue は .*担当が担当しています|注記を書く/).first().waitFor();
// PdM が起票できるのは PM 宛てだけ
await page.goto(`${BASE}/p/${pid}/issues`);
await btn(/新しい Issue/).click();
const opts = await page.getByLabel("宛先").locator("option").allTextContents();
if (opts.join() !== "事業PM,設計PM,実装PM") throw new Error(`宛先が PM だけでない: ${opts}`);
await page.getByLabel("題名").fill("⑨の状態遷移を見直して");
await page.getByLabel("宛先").selectOption("pm_design");
await btn("起票する").click();
await page.waitForURL(/\/issues\/\d+$/);
await shot("o3-new-issue", true);
// 掲示板：エージェント同士だけ。PdM は読むだけ（書く欄がない）
await page.goto(`${BASE}/p/${pid}/board`);
await page.getByRole("article").first().waitFor();
if (await page.getByLabel("本文").count()) throw new Error("掲示板に PdM の書く欄がある");
await shot("o4-board", true);
// PM の作業場所：対話・集めたこと・Issue
await page.goto(`${BASE}/p/${pid}/pm/pm_biz`);
await page.getByText("集めたこと（タスク管理の場所）").waitFor();
await page.getByText(/状況/).first().waitFor();
await shot("o5-pm", true);
// 工程の画面：右は「この領域の PM と話す」。担当とは直接話さない（案タブは採用・却下だけ）
await page.goto(`${BASE}/p/${pid}/s/s01`);
await page.getByText("この領域の PM と話す").waitFor();
await page.getByLabel("添付するファイル").setInputFiles({ name: "顧客メモ.md", mimeType: "text/markdown", buffer: Buffer.from("# 顧客\n共働きの夫婦") });
await page.getByRole("button", { name: "顧客メモ.mdを外す" }).waitFor();
await page.getByLabel("事業PMへの発言").fill("このメモを踏まえて顧客を見直して");
await btn("話す", true).click();
await page.getByText("顧客メモ.md").first().waitFor();
await page.getByText(/承知しました/).last().waitFor();
await btn("案タブ").click();
await page.getByText(/担当エージェントとは直接話せません/).waitFor();
await shot("o6-stage");
// 振り返りの会議：PM のレポートと突き合わせ → 会議の中で PM と話す
await page.goto(`${BASE}/p/${pid}`);
await btn("いま会議を始める").click();
await page.getByRole("link", { name: "会議に入る" }).click({ timeout: 30000 });
await page.getByRole("region", { name: "設計PMのレポート" }).getByText(/実行状況|スタブ/).first().waitFor({ timeout: 60000 });
await page.getByText(/食い違いは見つかりませんでした/).first().waitFor();
await page.getByRole("button", { name: /設計PM/ }).first().click();
await page.getByLabel("設計PMへの発言").fill("⑨は来週までに");
await btn("話す", true).click();
await page.getByText(/承知しました/).last().waitFor();
await shot("o7-meeting", true);
await btn("会議を終える").click();
// 組織：会議の予定・定期実行・顔を描く
await page.goto(`${BASE}/p/${pid}/team`);
await page.getByText("振り返りの会議の予定").waitFor();
await btn(/顔を描/).click();
await page.getByText(/顔を描いています/).waitFor();
await shot("o8-team", true);
// レールと ⌘K：工程を開く → ⌘K で「@⑨ …」→ 設計 PM に話す
await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: /⑨ アプリケーション設計/ }).click();
await page.waitForURL(/\/s\/s09$/);
await page.keyboard.press("Control+k");
await page.getByLabel("話しかける・移動する").last().fill("@⑨ 状態遷移に取消を足して");
await page.getByRole("option", { name: /設計PMに話す（⑨アプリケーション設計について）/ }).click();
await page.getByText(/設計PMが答えました/).waitFor();
await shot("o9-command");
await page.keyboard.press("Escape");
console.log(`ok product=${pid}`);
await browser.close();
