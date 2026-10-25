// 画面からひと通り確かめる：対話で下書き → 採用 → 更新、承認フロー、下流の要再確認、ステージの開閉、振り返り。
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/full-cycle.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const email = `e2e-${Date.now()}@example.com`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(20000);
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const btn = (name, exact = false) => page.getByRole("button", { name, exact });

await page.goto(`${BASE}/register`);
await shot("00-register");
await page.fill("input[name=name]", "E2E");
await page.fill("input[name=email]", email);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);

await page.fill("input[name=name]", "家計簿アプリ");
await page.fill("textarea[name=idea]", "共働き世帯の家計を5分で締められるアプリ");
await btn("作成", true).click();
await page.waitForURL(/\/p\/[0-9a-f]+$/);
const pid = page.url().split("/p/")[1];
await shot("01-overview", true);

async function draftAndCommit(sid, shotName, beforeCommit) {
  await page.goto(`${BASE}/p/${pid}/s/${sid}`);
  await btn("下書きを作って").click();
  const all = page.getByRole("button", { name: /件をすべて採用/ });
  await all.waitFor();
  if (shotName) await shot(`${shotName}-proposals`);
  await all.click();
  await all.waitFor({ state: "detached" });
  if (shotName) await shot(`${shotName}-canvas`);
  if (beforeCommit) await beforeCommit();
  await btn(/^更新/).first().click();
  await btn("更新", true).click();
  await page.getByText(/最新版 v\d+/).first().waitFor();
}

await draftAndCommit("s01", "02-lean");
// 手で直す：課題を編集して更新し直す
await page.getByRole("button", { name: "課題を編集" }).click();
await page.locator("textarea").first().fill("家計の締めに毎月2時間かかる\n夫婦で支出の状況が共有できない");
await btn("保存", true).click();
await page.getByText("家計の締めに毎月2時間かかる").waitFor();
await page.getByText("未更新の変更あり").waitFor();
await btn("更新する").click();
await btn("更新", true).click();
await page.getByText("最新版 v2").waitFor();

// 文書タブで書き換えると、キャンバスの項目に反映される
await page.goto(`${BASE}/p/${pid}/s/s01?tab=doc`);
await btn("文書を編集").click();
const doc = page.getByLabel("文書（Markdown）");
await doc.fill((await doc.inputValue()).replace("## 独自の価値提案\n", "## 独自の価値提案\n5分で締まる、夫婦の家計簿\n"));
await shot("02c-doc-edit");
await btn("キャンバスに反映").click();
await page.getByText(/項目に反映しました：独自の価値提案/).waitFor();
await page.goto(`${BASE}/p/${pid}/s/s01`);
await page.getByText("5分で締まる、夫婦の家計簿").first().waitFor();
await btn("更新する").click();
await btn("更新", true).click();
await page.getByText("最新版 v3").waitFor();

await draftAndCommit("s02", "03-market");
await draftAndCommit("s03", "04-competitors");
await draftAndCommit("s04", "05-vpc");
await draftAndCommit("s05", "06-plan", async () => {
  // KPIツリーをグラフで編集する：KPIを選ぶ → 子を足す → 分解の式を決める → 保存
  await page.locator(".react-flow__node").first().click();
  await btn("子KPIを追加").click();
  await page.getByLabel("名前").fill("解約率");
  await page.getByLabel("分解の式（子KPIの組み立て方）").selectOption("×");
  await btn("変更を保存").click();
  await page.getByText("保存していない変更があります").waitFor({ state: "detached" });
  await page.locator(".react-flow__node", { hasText: "解約率" }).waitFor();
  await shot("06-plan-kpi-graph");
});

// プロダクト・キャンバス：最初の1枚を生成すると表紙になり、サイドバーに出る
await page.goto(`${BASE}/p/${pid}/canvas`);
await btn("最初の1枚を生成する").click();
await page.getByAltText(/プロダクトイメージ/).waitFor();
await btn("生成する").click();
await page.getByText("これまでの絵（2）").waitFor();
await shot("06b-product-canvas", true);
await page.goto(`${BASE}/p/${pid}/s/s05?tab=doc`);
await shot("07-doc", true);

// ④を承認ありにして、修正指示 → 直して再提出 → 承認
await page.goto(`${BASE}/p/${pid}/settings`);
await page.getByRole("switch", { name: "プロダクト戦略の承認" }).click();
await page.waitForSelector('[aria-label="プロダクト戦略の承認"][aria-checked=true]');
await shot("08-settings", true);
await page.goto(`${BASE}/p/${pid}/s/s04`);
await page.getByRole("button", { name: "北極星指標を編集" }).click();
await page.locator("textarea").first().fill("週に1回以上、締めを完了した世帯数");
await btn("保存", true).click();
await page.getByText("週に1回以上、締めを完了した世帯数").first().waitFor();
await btn("更新して承認に回す").click();
await btn("更新", true).click();
await page.getByText(/が承認待ちです/).waitFor();
await btn("Request Changes").click();
await page.getByText("理由が必須").waitFor();
await page.getByPlaceholder(/理由・修正指示/).fill("撤退条件を数値で");
await btn("Request Changes").click();
await page.getByText("承認者の修正指示：撤退条件を数値で").waitFor();
await page.getByRole("button", { name: "撤退条件を編集" }).click();
await page.locator("textarea").first().fill("6か月で週次の締め完了世帯が100未満なら撤退");
await btn("保存", true).click();
await page.getByText("6か月で週次の締め完了世帯が100未満なら撤退").first().waitFor();
await btn("更新して承認に回す").click();
await btn("更新", true).click();
await page.getByText(/が承認待ちです/).waitFor();
await shot("09-approval");
await btn("Approve").click();
await page.getByText(/が承認待ちです/).waitFor({ state: "detached" });

// ④の最新版が変わったので、⑤が要再確認になる
await page.goto(`${BASE}/p/${pid}/s/s05`);
await page.getByText(/が更新されました。内容を見直し/).waitFor();
await shot("10-recheck");

// ⑦を閉じる
await page.goto(`${BASE}/p/${pid}/settings`);
await page.getByRole("switch", { name: "業務要求定義を使う" }).click();
await page.waitForSelector('[aria-label="業務要求定義を使う"][aria-checked=false]');

// 文書型のステージ（⑥）も同じ流れで更新できる
await draftAndCommit("s06", "11-doc-stage");
// 右のパネル：参照タブで事業フェーズの成果物を見る → AIタブを閉じる・開く
await btn("参照タブ").click();
await page.getByText("事業フェーズの成果物").waitFor();
await page.getByRole("button", { name: /④ プロダクト戦略/ }).click();
await page.getByText("北極星指標").first().waitFor();
await shot("11b-reference");
await btn("AIタブ").click();
await btn("AIタブを閉じる").click();
await btn("AIタブを閉じる").waitFor({ state: "detached" });
await btn("AIタブ").click();
await btn("下書きを作って").waitFor();

await page.goto(`${BASE}/p/${pid}/g/P1`);
await btn("進む", true).click();
await page.getByText("直近の記録").waitFor();
await shot("12-gate", true);

await page.goto(`${BASE}/p/${pid}`);
await page.getByAltText(/プロダクトイメージ/).waitFor();   // 概要の上部に表紙が出る
await shot("13-overview-after", true);
// サイドバーを隠す → 再読み込みしても隠れたまま → 表示に戻す
await btn("サイドバーを隠す").click();
await page.locator("aside").waitFor({ state: "detached" });
await page.reload();
await btn("サイドバーを表示").waitFor();
await shot("13b-nav-hidden");
await btn("サイドバーを表示").click();
await page.locator("aside").waitFor();
const recheck = await page.getByText("上流が更新されました").count();
const confirmed = await page.locator("main").getByText("更新済み", { exact: true }).count();
await page.goto(`${BASE}/p/${pid}/audit`);
await shot("14-audit");
console.log(JSON.stringify({ pid, confirmed, recheck }));
await browser.close();
