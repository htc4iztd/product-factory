// 社内のオントロジーとリサーチライブラリ：対話でプロダクトを作る → 表紙が自動でできる → 用語と関係を登録し、AI に渡る内容を確かめる
// → ライブラリを作り記事を足す → 論点・ファクト・分析・CSV → ②の対話にリサーチを取り込む
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/knowledge.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
page.setDefaultTimeout(30000);
page.on("dialog", (d) => d.accept());
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "KN");
await page.fill("input[name=email]", `kn-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);

// 対話で作ると、プロダクト・キャンバスの表紙がジョブで作られる
await page.goto(`${BASE}/new`);
for (const a of ["共働き世帯の家計簿アプリ。月次締めを楽にしたい", "共働きの夫婦。締め処理に時間がかかる", "レシートを撮るだけで締めまで終わる。MVP で"]) {
  await page.getByText("考えています…").waitFor({ state: "detached" });
  await page.getByLabel("返事").fill(a);
  await btn("送信", true).click();
}
await page.getByText("作れます", { exact: true }).waitFor();
await page.getByLabel("プロダクト名").fill("ふたりの家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];
await page.goto(`${BASE}/jobs?kind=canvas`);
await page.getByRole("link", { name: "ふたりの家計簿" }).first().waitFor();
for (let i = 0; i < 30; i++) {
  if (await page.getByText("完了").first().isVisible()) break;
  await page.waitForTimeout(1000);
  await page.reload();
}
await page.goto(`${BASE}/p/${pid}/canvas`);
await page.locator("img").first().waitFor();
await shot("k0-canvas-cover");

// オントロジー：用語と組織を登録してつなぐ
await page.goto(`${BASE}/ontology`);
await page.getByLabel("名前", { exact: true }).fill("月次締め");
await page.getByLabel("種類", { exact: true }).selectOption("process");
await page.getByLabel("定義").fill("月末にその月の支出を確定させる作業");
await page.getByLabel("別名").fill("締め処理");
await btn("足す").click();
await page.getByRole("cell", { name: "月次締め" }).waitFor();
await page.getByLabel("名前", { exact: true }).fill("家計担当");
await page.getByLabel("種類", { exact: true }).selectOption("role");
await page.getByLabel("定義").fill("世帯で家計の締めを受け持つ人");
await btn("足す").click();
await page.getByRole("cell", { name: "家計担当" }).waitFor();
await page.getByRole("cell", { name: "月次締め" }).click();
await page.getByLabel("関係の種類").selectOption("owned_by");
await page.getByLabel("相手").selectOption({ label: "家計担当" });
await btn("つなぐ").click();
await page.getByText("〜が担当").first().waitFor();
await page.getByLabel("確かめる文章").fill("締め処理を5分で終わらせたい");
await btn("確かめる").click();
await page.locator("pre").getByText(/月次締め/).waitFor();
await shot("k1-ontology", true);
await btn("グラフ").click();
await page.locator(".react-flow__node").nth(1).waitFor();
await shot("k2-ontology-graph");
const [ttl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Turtle" }).click()]);
const text = fs.readFileSync(await ttl.path(), "utf8");
if (!text.includes("skos:prefLabel") || !text.includes("月次締め")) throw new Error("Turtle の書き出しがおかしい");

// リサーチライブラリ：作る → 本文を貼って記事を足す（参考の資料室と同じ作り：ニュース・論点・調査・プレーヤー・ファクトDB・データ分析）
const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
await page.goto(`${BASE}/research`);
await page.locator("input[name=name]").fill("家計管理アプリの動向");
await page.locator("textarea[name=description]").fill("家計簿・家計管理サービスの利用実態");
await page.locator("textarea[name=issues]").fill("利用実態｜どの世帯がどれくらい使っているか\n締め処理");
await page.locator("textarea[name=entities]").fill("調査会社");
await btn("作る").click();
await page.waitForURL(/\/research\/\d+\?tab=settings/);
const lib = page.url().match(/research\/(\d+)/)[1];
await tab("記事を足す").click();
await page.getByLabel("URL", { exact: true }).fill("https://manual.example/kakeibo");
await page.getByLabel("題名", { exact: true }).fill("家計簿アプリの利用調査");
await page.getByLabel("本文", { exact: true }).fill("2026-10-20 調査会社による調査。共働き世帯の48%が家計簿アプリを使っている。市場規模は1200億円に達した。締め処理の手間が課題として挙がった。" + "本文。".repeat(60));
await btn("足す").click();
await page.getByText("読んでいます…").waitFor({ state: "detached" });
await tab("ニュース").click();
await page.getByRole("heading", { name: "家計簿アプリの利用調査" }).waitFor();
// メモ・質問（ジョブで答える）・ファクトの追加
await btn("メモを追加").click();
await page.getByLabel("メモ", { exact: true }).fill("②市場分析の根拠に使う");
await btn("保存", true).click();
await page.getByText("②市場分析の根拠に使う").waitFor();
await page.getByLabel("メモ", { exact: true }).waitFor({ state: "detached" });
await btn("この記事に質問する").click();
await page.getByLabel("この記事への質問").fill("誰が調べた？");
await btn("質問を送る").click();
await page.getByText(/（スタブ）「誰が調べた？」への答え/).waitFor({ timeout: 40000 });
await btn("ファクトを追加").click();
await page.getByPlaceholder("例：53%").fill("300万人");
await page.getByPlaceholder("例：サービスを週1回以上使う人の割合").fill("家計簿アプリの利用者数");
await btn("追加", true).click();
await page.getByText("300万人").first().waitFor();
await shot("k3-news", true);
await tab("論点").click();
await page.getByRole("heading", { name: "締め処理" }).waitFor();
await page.getByText("どの世帯がどれくらい使っているか").waitFor();
await shot("k4-issues", true);
await tab("ファクトDB").click();
await page.getByRole("cell", { name: "48%" }).waitFor();
const [csv] = await Promise.all([page.waitForEvent("download"), btn("CSVで保存").click()]);
if (!fs.readFileSync(await csv.path(), "utf8").includes("48%")) throw new Error("CSV にファクトがない");
await shot("k5-facts", true);
await tab("プレーヤー").click();
await btn("プレーヤーを更新").click();
await page.getByRole("button", { name: /調査会社/ }).first().waitFor({ timeout: 40000 });
await page.getByRole("button", { name: /調査会社/ }).first().click();
await page.getByText("記事集での登場 1件").waitFor();
await shot("k5b-players", true);
// 調査レポート：技術調査・業界調査・公的データ（スタブで形を確かめる）
for (const [t, check] of [["技術調査", "技術要素の全体像"], ["業界調査", "手続き・取引の流れ"], ["公的データ", "見本の統計"]]) {
  await tab(t).click();
  await btn(`${t}のレポートを作る`).click();
  await page.getByLabel("レポートの題").fill(`${t}の見本`);
  await btn("作る", true).click();
  await page.getByText(check).first().waitFor({ timeout: 40000 });
  await shot(`k5c-${t}`, true);
}
await page.getByText("サンプル規格").first().waitFor({ state: "detached" }).catch(() => {});
await tab("技術調査").click();
await page.getByRole("button", { name: "サンプル規格" }).first().click().catch(async () => { await page.locator("th", { hasText: "サンプル規格" }).first().click(); });
await page.getByText("主な処理の流れ").waitFor();
await shot("k5d-tech-doc", true);
// データ分析：概要・自由集計（セルから記事へ）・推移と増減・企業・AI の分析
await tab("データ分析").click();
await page.getByText("論点のランキング").waitFor();
await shot("k6-ana-sum", true);
await btn("自由集計").click();
await page.locator("td[title^='締め処理']").first().click();
await page.locator("#drill").getByText("家計簿アプリの利用調査").waitFor();
await shot("k6b-ana-pivot", true);
await btn("推移と増減").click();
await page.getByText("増えた・減った").waitFor();
await btn("企業・プレーヤー").click();
await page.getByText("一緒に出ることが多い企業・団体").waitFor();
await btn("AI に分析を頼む").click();
await page.getByLabel("問い").fill("利用は広がっているか");
await btn("分析する").click();
await page.getByRole("heading", { name: "利用は広がっているか", level: 3 }).waitFor();
await shot("k6c-ana-ask", true);
// すべて更新：記事 → 論点・プレーヤー・調査レポートを1つのジョブで（工程はジョブの画面で見られる）
await btn("すべて更新").click();
await btn("更新中…").first().waitFor();
await btn("すべて更新").waitFor({ timeout: 90000 });
await page.goto(`${BASE}/jobs?kind=research`);
await page.getByRole("link", { name: "リサーチライブラリの更新", exact: true }).first().click();
await page.locator(".react-flow__node").filter({ hasText: "公的データのレポート" }).waitFor();
await shot("k7b-update-all-job");
await page.goto(`${BASE}/research/${lib}`);
// 記事を選んで PowerPoint に
await tab("ニュース").click();
await page.getByLabel("この記事を選択").first().check();
const [deck] = await Promise.all([page.waitForEvent("download"), btn("PowerPointに出力").click()]);
if (fs.statSync(await deck.path()).size < 10000) throw new Error("PowerPoint が小さすぎる");

// ②の対話にリサーチを取り込む
await page.goto(`${BASE}/p/${pid}/s/s02`);
await btn("リサーチから取り込む").click();
await page.getByRole("combobox", { name: "ライブラリ" }).selectOption({ index: 0 });
await page.getByLabel("論点", { exact: true }).selectOption("締め処理");
await btn("送る", true).click();
await page.getByText(/リサーチライブラリ RL-\d+「家計管理アプリの動向」から/).waitFor();
await page.getByText("考えています…").waitFor({ state: "detached" });
await shot("k7-stage-import");
console.log(`ok product=${pid} library=RL-${lib}`);
await browser.close();
