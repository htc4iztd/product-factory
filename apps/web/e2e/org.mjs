// エージェントの組織と掲示板：ダッシュボード → 司令塔と話して決める → PM・担当に伝わる → 掲示板で追い、追加の指示を出す
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

// ①を進めておき、全員を動かす → 担当の報告がグラフに出る
await page.goto(`${BASE}/p/${pid}/s/s01`);
await btn("下書きを作って").click();
await page.getByRole("button", { name: /件をすべて採用/ }).waitFor();
await page.goto(`${BASE}/p/${pid}`);
await page.getByRole("region", { name: "司令塔との対話" }).waitFor();
await btn("全員を今すぐ動かす").click();
await btn("全員を今すぐ動かす").waitFor({ timeout: 60000 });
await page.locator(".react-flow__node-agent").filter({ hasText: "①アイディエーション担当" }).getByText(/必須/).waitFor({ timeout: 30000 });
await shot("o1-dashboard");
// 司令塔と話して決める → 決定が残り、PM が動いて答える
await page.getByLabel("司令塔への発言").fill("最初は共働き世帯で検証する。これで決定");
await btn("話す", true).click();
await page.getByText(/いまの戦略/).waitFor({ timeout: 30000 });
await page.locator(".react-flow__edge").filter({ hasText: "指示" }).first().waitFor({ timeout: 30000 });
await shot("o2-decided");
// 案ごとの見方
await page.getByRole("tab", { name: "案ごと" }).click();
await page.getByText(/まだ案（プリプロダクト）がありません/).waitFor();
await page.getByRole("tab", { name: "組織と工程" }).click();
await page.locator(".react-flow__node-agent").filter({ hasText: "PM" }).first().click();
await page.getByLabel("PMの報告").getByRole("link", { name: "掲示板で見る" }).click();
// 掲示板：PM のやり取りに絞って追い、①の担当に追加の指示
await page.waitForURL(/board\?agent=pm/);
await page.getByRole("article").filter({ hasText: "決定" }).first().waitFor();
await shot("o3-board", true);
await page.goto(`${BASE}/p/${pid}/board`);
await page.getByLabel("宛先").last().selectOption("s01");
await page.getByLabel("本文").fill("課題をもう1つ足して");
await btn("書き込む").last().click();
const th = page.getByRole("article").filter({ hasText: "課題をもう1つ足して" });
await th.locator("li").filter({ hasText: "受けました" }).waitFor({ timeout: 30000 });
await shot("o4-board-directive", true);
// 工程の画面：担当エージェントと話す（質問と直し案は「担当エージェントから」のセッション）
await page.goto(`${BASE}/p/${pid}/s/s01`);
await page.getByText("①アイディエーション担当と話す").waitFor();
await page.getByLabel("対話セッション").selectOption({ label: /担当エージェントから/ }).catch(async () => {
  const opt = await page.getByLabel("対話セッション").locator("option", { hasText: "担当エージェントから" }).getAttribute("value");
  await page.getByLabel("対話セッション").selectOption(opt);
});
await page.getByText(/方針を教えてください/).first().waitFor();
await shot("o5-stage-agent");
// 担当との対話に資料・画像を添える（その発言のときだけ読む）
await page.getByLabel("添付するファイル").setInputFiles({ name: "顧客メモ.md", mimeType: "text/markdown", buffer: Buffer.from("# 顧客\n共働きの夫婦") });
await page.getByRole("button", { name: "顧客メモ.mdを外す" }).waitFor();
await page.getByLabel("AIへの発言").fill("このメモを読んで顧客を見直して");
await btn("送信", true).click();
await page.locator("div").filter({ hasText: /^このメモを読んで顧客を見直して顧客メモ.md$/ }).first().waitFor();
await page.getByText("考えています…").waitFor({ state: "detached" });
await shot("o5b-attach");
// 組織とタスク・顔を描く
await page.goto(`${BASE}/p/${pid}/team`);
await page.getByText("エージェントの組織").first().waitFor();
await page.getByText(/を埋める/).first().waitFor();
await btn(/顔を描/).click();
await page.getByText(/顔を描いています/).waitFor();
for (let i = 0; i < 30 && !(await page.getByText("顔 16/16").isVisible()); i++) { await page.waitForTimeout(1000); await page.reload(); }
await shot("o6-team", true);
// レール（人の並び）と ⌘K：行き先を探す → 担当に話しかける
await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: /⑨ アプリケーション設計/ }).click();
await page.waitForURL(/\/s\/s09$/);
await page.keyboard.press("Control+k");
await page.getByLabel("話しかける・移動する").last().fill("掲示板");
await page.keyboard.press("Enter");
await page.waitForURL(/\/board$/);
await page.keyboard.press("Control+k");
await page.getByLabel("話しかける・移動する").last().fill("@⑨ 状態遷移に取消を足して");
await page.getByRole("option", { name: /⑨アプリケーション設計担当に話す/ }).click();
await page.getByText(/送りました/).waitFor();
await shot("o7-command");
await page.keyboard.press("Escape");
console.log(`ok product=${pid}`);
await browser.close();
