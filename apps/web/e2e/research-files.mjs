// リサーチライブラリに資料（PDF・Word）を上げる → 文字を取り出して記事にする → 元の資料を記事から開ける
// 使い方: BASE=http://localhost:3000 SHOTS=./shots node e2e/research-files.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });

// 文字だけの小さな PDF（ページごとに1行）
function pdf(lines) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const n = lines.length, font = 3 + n * 2;
  objs.push(`<< /Type /Pages /Kids [${lines.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  lines.forEach((t, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    const body = `BT /F1 12 Tf 72 760 Td (${t}) Tj ET`;
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(30000);
const btn = (name, exact = false) => page.getByRole("button", { name, exact });
const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

await page.goto(`${BASE}/register`);
await page.fill("input[name=name]", "RF");
await page.fill("input[name=email]", `rf-${Date.now()}@example.com`);
await page.fill("input[name=password]", "password123");
await btn("登録して始める").click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/research`);
await page.locator("input[name=name]").fill("資料の束");
await page.locator("textarea[name=issues]").fill("キャッシュレス");
await btn("作る").click();
await page.waitForURL(/\/research\/\d+\?tab=settings/);
const lib = page.url().match(/research\/(\d+)/)[1];

await tab("記事を足す").click();
const doc = pdf(["2026-10-20 Survey: 48% of households use cashless apps.", "Market size reached 1200 oku yen."]);
await page.getByLabel("上げる資料").setInputFiles([
  { name: "決済の調査.pdf", mimeType: "application/pdf", buffer: doc },
  { name: "壊れた.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 broken") },
]);
await page.getByText(/決済の調査\.pdf：RA-\d+ として足しました/).waitFor({ timeout: 60000 });
await page.getByText(/壊れた\.pdf：PDF として開けません/).waitFor({ timeout: 60000 });
await page.screenshot({ path: `${SHOTS}/rf1-upload.png` });

await page.goto(`${BASE}/research/${lib}?tab=news`);
const link = page.getByRole("link", { name: /決済の調査/ }).first();
await link.waitFor();
if (!(await page.getByText("資料", { exact: true }).first().isVisible())) throw new Error("資料の印がない");
const href = await link.getAttribute("href");
const r = await page.request.get(`${BASE}${href}`);
const body = await r.body();
if (r.status() !== 200 || !r.headers()["content-type"].includes("pdf") || !body.equals(doc)) throw new Error(`元の資料を開けない ${r.status()} ${href}`);
await page.goto(`${BASE}/research/${lib}?tab=facts`);
await page.getByText("48%").first().waitFor();
await page.screenshot({ path: `${SHOTS}/rf2-facts.png` });
await browser.close();
console.log("research-files ok");
