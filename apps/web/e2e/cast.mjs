// ペルソナ・スキル・ツール：⑥UXデザイン担当（UXデザイナー）のペルソナを変える → 独自の参照スキルを作り、直結スキルから参照
// → 割り当てて読み込みを確かめる → 書くツールを外すと警告 → 既定に戻す → ⑥UXデザインの画面（ジャーニー）
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/cast.mjs
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
await page.fill("input[name=name]", "CAST");
await page.fill("input[name=email]", `cast-${Date.now()}@example.com`);
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
await page.getByLabel("プロダクト名").fill("配役の家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];

// レールの道具から入る。最初は⑥UXデザイン担当（UXデザイナー）
await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: "ペルソナ・スキル" }).click();
await page.waitForURL(/\/cast$/);
const ed = page.getByLabel("⑥UXデザイン担当の設定");
await ed.getByText("工程の担当・UXデザイナー").waitFor();
const load = ed.getByRole("region", { name: "実行のときに読み込むもの" });
await load.getByText("ペルソナとジャーニーの描き方").waitFor();
await ed.getByLabel("話し方").fill("利用者の言葉で、場面を具体的に。専門用語には一言の説明を添える");
await btn("保存する").click();
await page.getByText("保存しました").waitFor();
await shot("c1-agent", true);

// 独自の参照スキルを作る → 直結スキル（独自）から参照する
await page.getByRole("tab", { name: /スキル（/ }).click();
await btn("スキルを作る").click();
const sk = page.getByRole("region", { name: "スキルの編集" });
await sk.getByLabel("スキルの id").fill("household-terms");
await sk.getByLabel("スキルの名前").fill("家計簿の用語");
await sk.getByLabel("スキルの本文").fill("- 締め：月末に家計を集計して確定すること\n- 立替：どちらかが一時的に払ったもの");
await sk.getByRole("button", { name: "保存する" }).click();
await page.getByText("保存しました").waitFor();
await btn("スキルを作る").click();
await sk.getByLabel("スキルの id").fill("household-ux");
await sk.getByLabel("スキルの名前").fill("家計簿の UX");
await sk.getByLabel("スキルの種類").selectOption("agent");
await sk.getByLabel("スキルの本文").fill("締めまでの体験を、用語集の言葉で設計する。");
await sk.getByLabel("参照 家計簿の用語").check();
await sk.getByLabel("参照 ユーザーフローと情報設計").check();
await sk.getByLabel("使う 工程の下書きを読む").check();
await sk.getByRole("button", { name: "保存する" }).click();
await page.getByText("保存しました").waitFor();
await shot("c2-skill", true);

// ⑥UXデザイン担当に割り当てる → 読み込みに独自のスキルと参照が入る
await page.getByRole("tab", { name: /エージェント/ }).click();
await ed.getByLabel("スキル 家計簿の UX").check();
await btn("保存する").click();
await page.getByText("保存しました").waitFor();
await load.getByText("家計簿の用語").waitFor();
// 書くツール（工程の項目に書き込む）を外すと、スキルが使うのに割り当てていないと警告
await ed.getByLabel("ツール 工程の項目に書き込む").uncheck();
await btn("保存する").click();
await load.getByText(/スキルが使うのに割り当てていないツール：set_field/).waitFor();
await shot("c3-assign", true);
await btn("既定に戻す").click();
await page.getByText("既定に戻しました").waitFor();
await load.getByText(/割り当てていないツール/).waitFor({ state: "detached" });

// ツールの一覧
await page.getByRole("tab", { name: /ツール（/ }).click();
await page.getByRole("region", { name: "ツール" }).getByText("CRUD マトリクスを作る").waitFor();

// ⑥UXデザインの画面：ジャーニーの欄がある
await page.goto(`${BASE}/p/${pid}/s/s06`);
await page.getByText("カスタマージャーニー").first().waitFor();
await page.getByText("ユーザーフロー").first().waitFor();
await shot("c4-ux", true);
console.log(`ok product=${pid}`);
await browser.close();
