// 工程の成果物（Markdown）を Word・PowerPoint・Markdown のファイルにする（ブラウザの中で作る）。PDF は印刷用のページから
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, Table, List } from "mdast";

const FONT = "Yu Gothic";
export type ExportDoc = { title: string; subtitle: string; markdown: string; filename: string };

const parse = (md: string) => unified().use(remarkParse).use(remarkGfm).parse(md) as Root;

// 文の中身（太字・斜体・コード・リンク）を、文字と飾りの並びにする
type Run = { text: string; bold?: boolean; italics?: boolean; code?: boolean };
function runs(nodes: PhrasingContent[], deco: Omit<Run, "text"> = {}): Run[] {
  return nodes.flatMap((n): Run[] => {
    if (n.type === "text") return [{ text: n.value, ...deco }];
    if (n.type === "strong") return runs(n.children, { ...deco, bold: true });
    if (n.type === "emphasis") return runs(n.children, { ...deco, italics: true });
    if (n.type === "delete") return runs(n.children, deco);
    if (n.type === "inlineCode") return [{ text: n.value, ...deco, code: true }];
    if (n.type === "link") return runs(n.children, deco);
    if (n.type === "break") return [{ text: "\n", ...deco }];
    return "value" in n && typeof n.value === "string" ? [{ text: n.value, ...deco }] : [];
  });
}
const plain = (nodes: PhrasingContent[]) => runs(nodes).map((r) => r.text).join("");
const cellText = (t: Table, r: number, c: number) => plain((t.children[r]?.children[c]?.children ?? []) as PhrasingContent[]);

// リストの項目を（深さ・番号・文）の並びにする
function items(l: List, depth = 0): { depth: number; mark: string; runs: Run[] }[] {
  return l.children.flatMap((li, i) => li.children.flatMap((c) => {
    if (c.type === "paragraph") return [{ depth, mark: l.ordered ? `${(l.start ?? 1) + i}.` : "•", runs: runs(c.children) }];
    if (c.type === "list") return items(c, depth + 1);
    return [];
  }));
}

function download(blob: Blob, name: string) {
  // 画面に置いてから押す（置かないと、ファイル名が付かないブラウザがある）
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function exportMarkdown(d: ExportDoc) {
  download(new Blob([d.markdown], { type: "text/markdown;charset=utf-8" }), `${d.filename}.md`);
}

// ---------------- Word ----------------
export async function exportWord(d: ExportDoc) {
  const x = await import("docx");
  const tr = (r: Run) => new x.TextRun({ text: r.text, bold: r.bold, italics: r.italics, font: r.code ? "Consolas" : undefined, break: r.text === "\n" ? 1 : undefined });
  const HEAD = [x.HeadingLevel.HEADING_1, x.HeadingLevel.HEADING_2, x.HeadingLevel.HEADING_3, x.HeadingLevel.HEADING_4];
  const out: (InstanceType<typeof x.Paragraph> | InstanceType<typeof x.Table>)[] = [
    new x.Paragraph({ heading: x.HeadingLevel.TITLE, children: [new x.TextRun(d.title)] }),
    new x.Paragraph({ children: [new x.TextRun({ text: d.subtitle, color: "666666" })] }),
  ];
  const block = (n: RootContent) => {
    if (n.type === "heading") out.push(new x.Paragraph({ heading: HEAD[Math.min(n.depth, 4) - 1], children: runs(n.children).map(tr) }));
    else if (n.type === "paragraph") out.push(new x.Paragraph({ children: runs(n.children).map(tr), spacing: { after: 120 } }));
    else if (n.type === "list") items(n).forEach((it) => out.push(new x.Paragraph({ indent: { left: 360 * (it.depth + 1), hanging: 260 }, children: [new x.TextRun(`${it.mark} `), ...it.runs.map(tr)] })));
    else if (n.type === "table") {
      const cols = n.children[0]?.children.length ?? 0;
      out.push(new x.Table({
        width: { size: 100, type: x.WidthType.PERCENTAGE },
        rows: n.children.map((row, r) => new x.TableRow({
          tableHeader: r === 0,
          children: Array.from({ length: cols }, (_, c) => new x.TableCell({
            shading: r === 0 ? { fill: "F2F2F2", type: x.ShadingType.CLEAR, color: "auto" } : undefined,
            children: [new x.Paragraph({ children: [new x.TextRun({ text: cellText(n, r, c), bold: r === 0, size: 18 })] })],
          })),
        })),
      }));
      out.push(new x.Paragraph({ children: [] }));
    } else if (n.type === "code") n.value.split("\n").forEach((l) => out.push(new x.Paragraph({ children: [new x.TextRun({ text: l || " ", font: "Consolas", size: 18 })], shading: { fill: "F5F5F5", type: x.ShadingType.CLEAR, color: "auto" } })));
    else if (n.type === "blockquote") n.children.forEach((c) => { if (c.type === "paragraph") out.push(new x.Paragraph({ indent: { left: 400 }, children: runs(c.children).map((r) => tr({ ...r, italics: true })) })); });
    else if (n.type === "thematicBreak") out.push(new x.Paragraph({ children: [] }));
  };
  parse(d.markdown).children.forEach(block);
  const doc = new x.Document({
    creator: "Product Factory", title: d.title,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ children: out }],
  });
  download(await x.Packer.toBlob(doc), `${d.filename}.docx`);
}

// ---------------- PowerPoint ----------------
// 見出し（##）ごとに1枚。中身が多ければ続きのスライドに分ける。表は表のまま（多い行は分ける）
export async function exportPowerPoint(d: ExportDoc) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const W = 13.33;
  const cover = pptx.addSlide();
  cover.addText(d.title, { x: 0.7, y: 2.6, w: W - 1.4, h: 1.2, fontFace: FONT, fontSize: 34, bold: true, color: "18181B" });
  cover.addText(d.subtitle, { x: 0.7, y: 3.8, w: W - 1.4, h: 0.6, fontFace: FONT, fontSize: 16, color: "71717A" });
  type Sec = { title: string; lines: { text: string; bullet: boolean; indent: number; bold?: boolean }[]; tables: Table[] };
  const secs: Sec[] = [];
  let cur: Sec | null = null;
  const sec = () => (cur ??= (secs.push({ title: d.title, lines: [], tables: [] }), secs[secs.length - 1]));
  for (const n of parse(d.markdown).children) {
    if (n.type === "heading" && n.depth <= 2) { if (n.depth === 1 && !secs.length && !cur) continue; cur = { title: plain(n.children), lines: [], tables: [] }; secs.push(cur); continue; }
    const s = sec();
    if (n.type === "heading") s.lines.push({ text: plain(n.children), bullet: false, indent: 0, bold: true });
    else if (n.type === "paragraph") s.lines.push({ text: plain(n.children), bullet: false, indent: 0 });
    else if (n.type === "list") items(n).forEach((it) => s.lines.push({ text: it.runs.map((r) => r.text).join(""), bullet: true, indent: it.depth }));
    else if (n.type === "table") s.tables.push(n);
    else if (n.type === "code") s.lines.push({ text: n.value, bullet: false, indent: 0 });
    else if (n.type === "blockquote") n.children.forEach((c) => c.type === "paragraph" && s.lines.push({ text: plain(c.children), bullet: false, indent: 1 }));
  }
  const head = (sl: ReturnType<typeof pptx.addSlide>, t: string) => {
    sl.addText(t, { x: 0.5, y: 0.3, w: W - 1, h: 0.8, fontFace: FONT, fontSize: 24, bold: true, color: "18181B" });
    sl.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.1, w: W - 1, h: 0, line: { color: "E4E4E7", width: 1 } });
  };
  const PER = 12; // 1枚に入れる行の目安
  for (const s of secs) {
    for (let i = 0; i < Math.max(1, Math.ceil(s.lines.length / PER)); i++) {
      const part = s.lines.slice(i * PER, (i + 1) * PER);
      if (!part.length && (i > 0 || s.tables.length)) continue;
      const sl = pptx.addSlide();
      head(sl, i ? `${s.title}（続き）` : s.title);
      sl.addText(part.length ? part.map((l) => ({ text: l.text, options: { bullet: l.bullet ? { indent: 18 } : false, indentLevel: l.indent, bold: l.bold, breakLine: true } })) : [{ text: "（記入なし）", options: { color: "A1A1AA" } }],
        { x: 0.6, y: 1.3, w: W - 1.2, h: 5.8, fontFace: FONT, fontSize: 15, color: "27272A", valign: "top", paraSpaceAfter: 4 });
    }
    for (const t of s.tables) {
      const cols = t.children[0]?.children.length ?? 0;
      const rows = t.children.map((_, r) => Array.from({ length: cols }, (_, c) => ({ text: cellText(t, r, c), options: r === 0 ? { bold: true, fill: { color: "F4F4F5" } } : {} })));
      const ROWS = 10;
      for (let i = 1; i < Math.max(2, rows.length); i += ROWS) {
        const sl = pptx.addSlide();
        head(sl, i > 1 ? `${s.title}（表の続き）` : s.title);
        sl.addTable([rows[0], ...rows.slice(i, i + ROWS)], { x: 0.5, y: 1.3, w: W - 1, fontFace: FONT, fontSize: cols > 5 ? 9 : 11, border: { type: "solid", color: "E4E4E7", pt: 0.75 }, autoPage: false });
      }
    }
  }
  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  download(blob, `${d.filename}.pptx`);
}
