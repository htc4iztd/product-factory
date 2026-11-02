// サイクル・プロダクトレビュー・リリース：サイクルの計画（数と位置付け）→ レビューを始める（定期実行を止める）
// → 各 PM のレビュー → PdM が修正を指示 → 担当が直す → もう一度レビュー → 完了してリリースへ
// → リリースエージェントが環境と方式を定義 → リリース前レビューで承認 → 手動でリリース → 次のサイクル
// （PM が工程ごとの目標を決めて担当に Issue を出す）
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/cycle.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(30000);
page.on("dialog", (d) => d.accept());
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "CYCLE");
await page.fill("input[name=email]", `cycle-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/new`);
for (const a of ["共働き世帯の家計簿アプリ", "夫婦で家計を共有できない", "レシートを撮るだけで記録できる。MVP で"]) {
  await page.getByText("考えています…").waitFor({ state: "detached" });
  await page.getByLabel("返事").fill(a);
  await btn("送信", true).click();
}
await page.getByText("作れます", { exact: true }).waitFor();
await page.getByLabel("プロダクト名").fill("ふたりの家計簿");
await btn("この内容でプロダクトをつくる").click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];
await page.getByText(/^サイクル 1/).first().waitFor();

// レールからプロダクトレビューへ。まずサイクルの計画（数と位置付け）を決める
await page.getByRole("navigation", { name: "エージェント" }).getByRole("link", { name: "プロダクトレビュー" }).click();
await page.waitForURL(/\/review$/);
const plan = page.getByLabel("サイクルの計画");
await plan.getByRole("button", { name: "例を入れる" }).click();
await plan.getByLabel("サイクル 3 の位置付け").waitFor();
await plan.getByLabel("サイクル 1 の位置付け").fill("PoC用プロトタイプ");
await plan.getByRole("button", { name: "保存" }).click();
await plan.getByText("保存しました").waitFor();
await page.getByRole("heading", { name: /プロダクトレビュー（サイクル 1：PoC用プロトタイプ）/ }).waitFor();
await page.goto(`${BASE}/p/${pid}`);
await page.getByText("サイクル 1：PoC用プロトタイプ（全 3）").waitFor();
await page.goto(`${BASE}/p/${pid}/s/s01`);
await page.getByLabel("このサイクルの目標").getByText(/PoC用プロトタイプ/).waitFor();
await page.goto(`${BASE}/p/${pid}/review`);
// 100%前でも PdM がレビューを始められる（確認のダイアログあり）。まず各 PM がレビューする
await btn("プロダクトレビューを始める").click();
const rv = page.getByLabel("PM のレビュー");
await rv.getByText("PM のレビューが出ました").waitFor({ timeout: 60000 });
for (const n of ["事業PMのレビュー", "設計PMのレビュー", "実装PMのレビュー"]) await rv.getByLabel(n).waitFor();
// サイクルの成果物は①〜⑬（⑭リリースはサイクルの外）
for (const n of ["①アイディエーションの成果物", "⑬テストの成果物"]) await page.getByLabel(n).waitFor();
if (await page.getByLabel("⑭リリースの成果物").count()) throw new Error("⑭がレビューに入っている");
await shot("c1-review", false);
// レビュー中は動かせない
await page.goto(`${BASE}/p/${pid}`);
await page.getByLabel("プロダクトレビュー中").waitFor();
await page.getByRole("link", { name: "レビューを開く" }).click();
await page.waitForURL(/\/review$/);
// PdM が PM に修正を指示 → PM が担当に Issue → 担当が直す
await page.getByLabel("事業PMへの修正の指示").fill("④に、夫婦で共有する価値を足す");
await btn("PM に修正を指示する").click();
await page.getByLabel("修正の指示").getByText("④に、夫婦で共有する価値を足す").waitFor();
await rv.getByText("修正が終わりました").waitFor({ timeout: 90000 });
// もう一度 PM にレビューさせる（第 2 回）→ 完了してリリースに進む
await btn("もう一度 PM にレビューさせる").click();
await rv.getByRole("button", { name: "第 2 回" }).waitFor();
await rv.getByText("PM のレビューが出ました").waitFor({ timeout: 60000 });
await shot("c2-rounds", false);
await btn("レビューを完了してリリースに進む").click();
await page.getByRole("link", { name: "リリースを開く" }).first().click();
await page.waitForURL(/\/release$/);
// リリースエージェントがリリース先の環境と方式を定義する（オンボーディング）→ リリース前レビュー
await page.getByLabel("いまの状態").getByText("リリース前レビュー待ち").waitFor({ timeout: 60000 });
const def = page.getByLabel("リリースの定義");
await def.getByText("リリース先の環境").waitFor();
await def.getByText("ブルーグリーン").waitFor();
// 接続先（手動）を決めて承認 → 手順書のとおりに作業 → 完了
await page.getByRole("radio", { name: "手動（手順書）" }).click();
await btn("接続先を保存").click();
await page.getByLabel("リリースの接続先").getByText("保存しました").waitFor();
await btn("リリースを承認する").click();
await page.getByLabel("手動のリリース").waitFor({ timeout: 60000 });
await page.getByLabel("作業のメモ").fill("本番に出した");
await btn("リリースを完了にする").click();
await page.getByLabel("リリースの結果").getByText("リリースしました").first().waitFor();
await shot("c3-release", true);
// サイクル完了 → 次のサイクルの位置付け（計画の MVP）・戦略・PM への追加指示
await page.goto(`${BASE}/p/${pid}/review`);
await page.getByLabel("次のサイクル").getByText("サイクル 2 の位置付け：MVP").waitFor();
await page.getByLabel("レビューの所見").fill("入力が面倒という声が多い");
await page.getByLabel("次のサイクルの戦略").fill("継続率を上げる。夫婦で同じ家計を見られるようにする");
await page.getByLabel("事業PMへの追加指示").fill("競合の共有機能を調べ直す");
await btn("サイクル 2 を始める").click();
await page.waitForURL(new RegExp(`/p/${pid}$`), { timeout: 60000 });
await page.getByText(/サイクル 2：MVP/).first().waitFor();
// PM が工程ごとの目標を決め、担当に Issue を出す
await page.goto(`${BASE}/p/${pid}/issues?all=1`);
for (let i = 0; i < 30 && !(await page.getByText(/サイクル 2 の目標/).count()); i++) { await page.waitForTimeout(1000); await page.reload(); }
await page.getByText(/サイクル 2 の目標/).first().waitFor();
// 工程の画面に、このサイクルの目標が出る
await page.goto(`${BASE}/p/${pid}/s/s01`);
await page.getByLabel("このサイクルの目標").getByText(/の目標：/).waitFor();
await shot("c2-stage-goal");
// レビュー画面に、これまでのサイクルが残る
await page.goto(`${BASE}/p/${pid}/review`);
await page.getByLabel("これまでのサイクル").getByText("入力が面倒という声が多い", { exact: false }).waitFor();
console.log(`ok product=${pid}`);
await browser.close();
