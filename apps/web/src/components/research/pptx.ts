// 選んだ記事を PowerPoint にする：表紙・一覧・1記事1枚（要約・ファクト・メモ。質問と回答はノートに）
import type { ResearchData } from "@/lib/agent";
import type { Art, Model } from "./model";

const FONT = "Meiryo";
const INK = "18181B", SUB = "71717A", ACC = "4F46E5", LINE = "E4E4E7";

export async function exportDeck(d: ResearchData, M: Model, arts: Art[]) {
  if (!arts.length) return;
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
  const list = [...arts].sort((a, b) => ((a.published ?? "") < (b.published ?? "") ? 1 : -1));

  const cover = pptx.addSlide();
  cover.addText(d.name, { x: 0.7, y: 2.4, w: 12, h: 1, fontFace: FONT, fontSize: 32, bold: true, color: INK });
  cover.addText(`${d.key}・選んだ記事 ${list.length}件・${today}`, { x: 0.7, y: 3.4, w: 12, h: 0.5, fontFace: FONT, fontSize: 14, color: SUB });
  if (d.description) cover.addText(d.description, { x: 0.7, y: 4.0, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 12, color: SUB, valign: "top" });

  const per = 12;
  for (let i = 0; i < list.length; i += per) {
    const s = pptx.addSlide();
    s.addText(`記事の一覧（${i + 1}〜${Math.min(i + per, list.length)} / ${list.length}）`, { x: 0.5, y: 0.3, w: 12, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: INK });
    const rows = [["日付", "地域", "発信元", "見出し"].map((t) => ({ text: t, options: { bold: true, color: SUB, fill: { color: "F4F4F5" } } })),
      ...list.slice(i, i + per).map((a) => [a.published ?? "", a.jp ? "国内" : a.country || "海外", a.publisher, a.head].map((t) => ({ text: t })))];
    s.addTable(rows, { x: 0.5, y: 0.9, w: 12.3, colW: [1.2, 0.8, 2.3, 8], fontFace: FONT, fontSize: 10, color: INK, border: { type: "solid", color: LINE, pt: 0.5 }, autoPage: false });
  }

  for (const a of list) {
    const s = pptx.addSlide();
    const meta = [a.published ?? "日付不明", a.jp ? "国内" : a.country || "海外", d.options.categories[a.category] ?? a.category, a.publisher, a.key].filter(Boolean).join("　");
    s.addText(meta, { x: 0.5, y: 0.25, w: 12.3, h: 0.35, fontFace: FONT, fontSize: 10, color: SUB });
    s.addText(a.head, { x: 0.5, y: 0.6, w: 12.3, h: 0.9, fontFace: FONT, fontSize: 20, bold: true, color: INK, valign: "top", hyperlink: a.url.startsWith("http") ? { url: a.url } : undefined });
    if (a.title_ja && a.title_ja !== a.title) s.addText(`原題：${a.title}`, { x: 0.5, y: 1.45, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 9, color: SUB });
    s.addText(a.summary, { x: 0.5, y: 1.85, w: 7.4, h: 3.6, fontFace: FONT, fontSize: 13, color: INK, valign: "top", paraSpaceAfter: 6 });
    const fs = (M.factsBy[a.key] ?? []).slice(0, 5);
    if (fs.length) {
      s.addText("ファクト", { x: 8.2, y: 1.85, w: 4.6, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: ACC });
      s.addText(fs.map((f) => ({ text: `${f.value}　${f.metric}${f.scope ? `（${f.scope}）` : ""}`, options: { bullet: true, breakLine: true } })),
        { x: 8.2, y: 2.2, w: 4.6, h: 3.3, fontFace: FONT, fontSize: 11, color: INK, valign: "top" });
    }
    if (a.memo) {
      s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 5.65, w: 12.3, h: 1.2, fill: { color: "FFFBEB" }, line: { color: "FDE68A" } });
      s.addText(`メモ：${a.memo}`, { x: 0.65, y: 5.7, w: 12, h: 1.1, fontFace: FONT, fontSize: 11, color: "78350F", valign: "top" });
    }
    s.addText(a.url, { x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 8, color: SUB });
    const qa = (d.questions[a.key] ?? []).filter((q) => q.state === "answered");
    if (qa.length) s.addNotes(qa.map((q) => `Q. ${q.question}\nA. ${q.answer}`).join("\n\n"));
  }
  await pptx.writeFile({ fileName: `${d.name}_記事${list.length}件.pptx` });
}
