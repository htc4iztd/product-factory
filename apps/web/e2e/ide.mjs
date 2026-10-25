import { chromium } from "playwright";
// IDE（コード画面）を確かめる。IDE_ORIGIN を設定した web と、GitHub に出られる agent-api が要る。
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/ide.mjs
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3000", SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);

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
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
page.on("response", (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "IDE");
await page.fill("input[name=email]", `ide-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await page.getByRole("button", { name: "登録して始める" }).click();
await page.waitForURL(`${BASE}/`);
await createProduct("IDEテスト", "コードを見る");
const pid = page.url().split("/p/")[1];
await page.getByRole("link", { name: /コード（IDE）/ }).click();
await page.fill("#repo", "https://github.com/htc4iztd/product-factory");
await page.screenshot({ path: `${SHOTS}/ide-00-link.png` });
await page.getByRole("button", { name: "つなぐ" }).click();
await page.waitForSelector("iframe[title=IDE]");
const f = page.frameLocator("iframe[title=IDE]");
await f.getByRole("treeitem", { name: /README\.md/ }).waitFor({ timeout: 60000 });
await page.screenshot({ path: `${SHOTS}/ide-01-tree.png` });
await f.getByRole("treeitem", { name: /README\.md/ }).click();
await f.locator(".monaco-editor .view-lines").first().waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/ide-02-file.png` });
await f.getByRole("treeitem", { name: "services", exact: true }).click();
await f.getByRole("treeitem", { name: "pf_agent", exact: true }).click();
await f.getByRole("treeitem", { name: "engine.py", exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/ide-03-py.png` });
console.log(JSON.stringify({ pid, errs: errs.slice(0, 20) }, null, 1));
await browser.close();
