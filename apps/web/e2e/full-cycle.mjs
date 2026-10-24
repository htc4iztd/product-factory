// R0 完了条件の確認：画面から仮の入力で P0〜P5 を一周する。
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/full-cycle.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const email = `e2e-${Date.now()}@example.com`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

await page.goto(`${BASE}/register`);
await page.fill('input[name=name]', "E2E");
await page.fill('input[name=email]', email);
await page.fill('input[name=password]', "password123");
await page.click("button:has-text('登録して始める')");
await page.waitForURL(`${BASE}/`);

await page.fill('input[name=name]', "家計簿アプリ");
await page.fill('textarea[name=idea]', "共働き世帯の家計を5分で締められるアプリ");
await page.click("button:has-text('作成')");
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];
await shot("01-overview");

const phases = { P1: ["s01", "s02", "s03"], P2: ["s04", "s05"], P3: ["s06", "s07", "s08", "s09", "s10", "s11"], P4: ["s12", "s13"], P5: ["s14"] };
let first = true;
for (const [ph, stages] of Object.entries(phases)) {
  for (const sid of stages) {
    await page.goto(`${BASE}/p/${pid}/s/${sid}`);
    await page.click("button:has-text('このステージを始める')");
    await page.waitForSelector("textarea[name=answer]");
    if (first) await shot("02-clarify");
    await page.fill("textarea[name=answer]", `仮の回答（${sid}）`);
    await page.click("button:has-text('回答して成果物を作る')");
    await page.waitForSelector("button[value=Approve]");
    if (first) await shot("03-approval");
    if (first) {
      // 理由なしの Request Changes は弾かれる
      await page.click("button[value='Request Changes']");
      await page.waitForSelector("text=理由が必須");
      await page.fill("textarea[name=comment]", "対象顧客をもっと具体的に");
      await page.click("button[value='Request Changes']");
      await page.waitForSelector("text=承認（v2）");
    }
    await page.click("button[value=Approve]");
    await page.waitForSelector("text=やり直す");
    if (first) { await shot("04-completed"); first = false; }
  }
  if (ph !== "P5") {
    await page.goto(`${BASE}/p/${pid}/g/${ph}`);
    await page.click("button[value=proceed]");
    await page.waitForSelector("text=直近の審査：進む");
    if (ph === "P1") await shot("05-gate");
  }
}
await page.goto(`${BASE}/p/${pid}`);
await shot("06-done");
const chips = await page.locator("main >> text=完了").count();
await page.goto(`${BASE}/p/${pid}/audit`);
await shot("07-audit");
console.log(JSON.stringify({ pid, completedChips: chips }));
await browser.close();
