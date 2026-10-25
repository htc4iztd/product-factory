// GitHub Issues 連携：トークンを入れる → リポジトリをつなぐ → 同期を「⑫⑬だけ」にする → ⑫のチケットが Issue になる
// → 範囲外のチケットを手で起票 → GitHub で閉じたら取り込みで完了になる。
// 手元では PF_GITHUB_API を偽の GitHub（acme/app）に向けて動かす。
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/github.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
const FAKE = process.env.FAKE_GITHUB ?? "http://127.0.0.1:8300";
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
const openCreate = () => page.evaluate(() => {
  const d = [...document.querySelectorAll("details")].find((x) => x.textContent?.includes("チケットを作る"));
  if (d) d.open = true;
});

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "GH");
await page.fill("input[name=email]", `gh-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);

await page.goto(`${BASE}/settings`);
await page.getByLabel("GitHub のトークン").fill("github_pat_test_1234");
await page.getByRole("region", { name: "GitHub 連携" }).getByRole("button", { name: "保存", exact: true }).click();
await page.getByText("このテナントのトークン").waitFor();
await btn("接続テスト").last().click();
await page.getByText("つながりました（octo）").waitFor();

await page.goto(`${BASE}/`);
await createProduct("GH連携", "x");
const pid = page.url().split("/p/")[1];
await page.goto(`${BASE}/p/${pid}/code?edit=1`);
await page.fill("#repo", "acme/app");
await btn("つなぐ").click();
await page.waitForURL(/\/code$/);

await page.goto(`${BASE}/p/${pid}/tickets`);
await page.getByLabel("Issues と同期").selectOption("build");
await page.getByText("保存しました").waitFor();
await openCreate();
await page.getByLabel("タイトル").fill("ログイン画面を作る");
await page.getByLabel("ステージ").selectOption("s12");
await btn("作成", true).click();
await page.waitForURL(/tickets\/\d+$/);
await page.getByRole("link", { name: /acme\/app#1/ }).waitFor();
await shot("g1-ticket-issue");

await page.goto(`${BASE}/p/${pid}/tickets`);
await openCreate();
await page.getByLabel("タイトル").fill("市場の追加調査");
await btn("作成", true).click();
await page.waitForURL(/tickets\/2$/);
await btn("GitHub に Issue として起票").click();
await page.getByRole("link", { name: /acme\/app#2/ }).waitFor();

// GitHub 側で #1 を閉じる → 取り込むと完了
await fetch(`${FAKE}/__human_close`, { method: "POST" });
await page.goto(`${BASE}/p/${pid}/tickets`);
await btn("今すぐ取り込む").click();
await page.getByText(/取り込みました（更新 1/).waitFor();
await page.getByRole("region", { name: "完了" }).getByText("ログイン画面を作る").waitFor();
await shot("g2-board");
console.log(JSON.stringify({ pid, ok: true }));
await browser.close();
