// 工程の担当（専門家）との相談：工程から「担当に相談」→ 相談の部屋（右のチャットは出ない）→ 相談を始める → 問いが流れて届く
// → 決めたことを話す → 合意メモに残す承認依頼 → 承認で合意メモに入る → 手で足す・消す → 合意メモから下書きを頼む
// → スマホでも同じ相談を続けられる（合意メモ・話題が「担当に相談」）
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/consult.mjs
import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const pc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await pc.newPage();
page.setDefaultTimeout(30000);
const shot = (n, p = page) => p.screenshot({ path: `${SHOTS}/${n}.png` });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "CONSULT");
await page.fill("input[name=email]", `consult-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("相談する家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

await page.goto(`${BASE}/p/${pid}/s/s06`);
await page.getByRole("link", { name: "担当に相談" }).click();
await page.waitForURL(/\/s\/s06\/consult$/);
const room = page.getByLabel("担当との相談");
if (await page.getByRole("complementary", { name: "チャット" }).count()) throw new Error("相談の部屋に右のチャットが出ている");
await room.getByText("⑥UXデザイン担当に相談する").waitFor();
await room.getByRole("button", { name: "相談を始める" }).click();
await room.getByLabel("返事を書いています").waitFor();
await room.locator("[data-msg]").filter({ hasText: "最初に一番うれしくなってほしい人" }).waitFor();
await shot("k1-start");
// 決めたことを話す → 合意メモの承認依頼 → 承認
await room.getByLabel("相談に話す").fill("対象は共働きの夫婦に絞る");
await room.getByLabel("相談に話す").press("Enter");
const card = room.getByRole("group", { name: /承認依頼：⑥UXデザインの合意メモに残す/ }).last();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
const notes = room.getByLabel("合意メモ", { exact: true });
await notes.getByText("対象は共働きの夫婦に絞る").waitFor();
// 手で足す・消す
await room.getByLabel("合意メモを足す").fill("MVP は締めの1タスク");
await room.getByRole("button", { name: "合意メモに足す" }).click();
await notes.getByText("MVP は締めの1タスク").waitFor();
await notes.locator("li").filter({ hasText: "MVP は締めの1タスク" }).hover();
await notes.locator("li").filter({ hasText: "MVP は締めの1タスク" }).getByRole("button", { name: "合意メモを消す" }).click();
await notes.getByText("MVP は締めの1タスク").waitFor({ state: "detached" });
// 合意メモから下書きを頼む
await room.getByRole("button", { name: "合意メモから下書きを作ってもらう" }).click();
await room.locator("[data-msg]").filter({ hasText: "合意メモをもとに" }).first().waitFor();
await shot("k2-notes");
// 知識の見出し
await room.getByText("⑥UXデザイン担当が持っている知識").click();
await room.getByText("・ゼロから磨き上げる順番").waitFor();

// 部屋の中の発言への返事は、部屋の入力欄で受ける（右のチャットへは行かない）
await room.locator("[data-msg]").filter({ hasText: "最初に一番うれしくなってほしい人" }).getByRole("button", { name: /返事をする/ }).click();
await room.getByLabel("相談の入力").getByLabel("引用", { exact: true }).waitFor();
await room.getByLabel("相談に話す").fill("共働きの夫婦です");
await room.getByLabel("相談に話す").press("Enter");
await room.locator("[data-msg]").filter({ hasText: "共働きの夫婦です" }).first().waitFor();
// 相談の部屋のやり取りは、右のチャットには出ない
await page.goto(`${BASE}/p/${pid}/s/s06`);
const side = page.getByRole("complementary", { name: "チャット" });
await side.waitFor();
await page.waitForTimeout(1500);
if (await side.getByText("対象は共働きの夫婦に絞る").count()) throw new Error("相談の部屋のやり取りが右のチャットに出ている");
// ②市場分析の画面から、リサーチライブラリへ
await page.goto(`${BASE}/p/${pid}/s/s02`);
await page.getByRole("link", { name: "リサーチライブラリ" }).first().click();
await page.waitForURL(/\/research$/);

// スマホ：同じ相談の続き
const sp = await browser.newContext({ ...devices["iPhone 13"], storageState: await pc.storageState() });
const m = await sp.newPage();
m.setDefaultTimeout(30000);
await m.goto(`${BASE}/p/${pid}/s/s06`);
await m.getByRole("link", { name: "担当に相談" }).click();
await m.waitForURL(/\/s\/s06\/consult$/);
await m.getByText(/合意メモ（1）/).waitFor();
await m.getByLabel("話題：⑥UXデザインの担当に相談").waitFor();
await m.getByLabel("チャットに話す").fill("代替手段は Excel です");
await m.getByRole("button", { name: "チャットを送る" }).click();
await m.locator("[data-msg]").filter({ hasText: "代替手段は Excel です" }).first().waitFor();
await m.locator("[data-msg]").filter({ hasText: "⑥UXデザインの担当です" }).last().waitFor();
if (await m.getByRole("dialog", { name: "チャット" }).count()) throw new Error("相談なのにチャットが下から出た");
await shot("k3-mobile", m);
console.log("consult e2e OK", pid);
await browser.close();
