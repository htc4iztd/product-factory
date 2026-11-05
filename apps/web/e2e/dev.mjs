// 開発：⑫の担当が作業場にコードを書く → 開発の画面でユニット・変更の記録・差分・ファイルが見える（GitHub 未連携でも）
// （チャットで実装PM に頼む → ⑫に Issue → 承認で⑫が動く）
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/dev.mjs
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
await page.fill("input[name=name]", "DEV");
await page.fill("input[name=email]", `dev-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("作る家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// まだ何もない開発の画面（GitHub 未連携でも作業場は使える）
await page.goto(`${BASE}/p/${pid}/code`);
const dev = page.getByLabel("開発", { exact: true });
await dev.getByText(/GitHub は未連携です/).waitFor();
await dev.getByText(/まだありません。⑫の担当が Issue を受けて動くと/).waitFor();
// ⑫の画面から実装PM に頼む → ⑫に Issue（承認）→ ⑫が動いてコードを書く
await page.goto(`${BASE}/p/${pid}/s/s12`);
await page.getByLabel("チャットに話す").fill("最初のユニットを作って");
await btn("チャットを送る").click();
const card = page.getByRole("group", { name: /承認依頼：/ }).last();
await card.getByRole("button", { name: "承認", exact: true }).click();
await card.getByText(/承認しました/).waitFor();
await page.getByRole("link", { name: "開発を見る" }).click();
await page.waitForURL(/\/code$/);
// 数秒ごとに読み直すので、⑫が書くとそのまま出る
await dev.getByRole("button", { name: /⑫コーディング担当/ }).first().waitFor({ timeout: 90000 });
await dev.getByLabel("差分").getByText(/^\+?"""UN-/).first().waitFor({ timeout: 30000 }).catch(async () => {
  await dev.getByRole("button", { name: /⑫コーディング担当/ }).first().click();
  await dev.getByLabel("差分").waitFor();
});
await dev.getByLabel("差分").getByText("README.md").first().waitFor();
await shot("d1-diff");
await dev.getByRole("tab", { name: /ファイル/ }).click();
await dev.getByLabel("ファイルの一覧").getByRole("button", { name: /README\.md/ }).click();
await dev.getByText("作る家計簿").first().waitFor();
await shot("d2-files");
console.log("dev e2e OK", pid);
await browser.close();
