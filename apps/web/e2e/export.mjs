// 工程の成果物の書き出し：Word（.docx）・PowerPoint（.pptx）・Markdown（.md）をダウンロード、PDF は印刷用のページが開く
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/export.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// 試験用のブラウザは、日本語のファイル名を "download" にしてしまうので、ページが付けた名前を控えて確かめる
await ctx.addInitScript(() => {
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) (window.__dl ??= []).push(this.download); return click.call(this); };
});
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "EXP");
await page.fill("input[name=email]", `exp-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("書き出す家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];
await page.goto(`${BASE}/p/${pid}/s/s01`);

const get = async (label) => {
  await btn("書き出す").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click()]);
  const path = `${SHOTS}/export-${label}`;
  await dl.saveAs(path);
  const name = await page.evaluate(() => window.__dl.at(-1));
  return { name, buf: fs.readFileSync(path) };
};
const word = await get("Word");
if (!word.name.endsWith(".docx") || word.buf.subarray(0, 2).toString() !== "PK" || !word.buf.includes("word/document.xml")) throw new Error("Word になっていない");
const ppt = await get("PowerPoint");
if (!ppt.name.endsWith(".pptx") || !ppt.buf.includes("ppt/slides/slide2.xml")) throw new Error("PowerPoint になっていない");
const md = await get("Markdown");
if (!md.name.endsWith(".md") || !md.buf.toString().includes("アイディエーション")) throw new Error("Markdown になっていない");
console.log("sizes", word.buf.length, ppt.buf.length, md.buf.length, word.name);
// PDF：印刷用のページが新しいタブで開く（チャットやメニューは出ない）
await btn("書き出す").click();
const [tab] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("menuitem", { name: /^PDF/ }).click()]);
await tab.waitForURL(/\/print\/p\/.+\/s\/s01$/);
await tab.getByRole("heading", { name: /① アイディエーション/ }).first().waitFor();
await tab.getByText("PDF に保存").first().waitFor();
if (await tab.getByLabel("チャット", { exact: true }).count()) throw new Error("印刷用のページにチャットが出ている");
await tab.pdf({ path: `${SHOTS}/export.pdf` });
console.log("export e2e OK", pid);
await browser.close();
