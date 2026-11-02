// 既存の HTML を UI エディタの画面に取り込む：body の中身と style を取り出し、動くもの（script・on〜・javascript:）は外す
export type Imported = { name: string; html: string; css: string; notes: string[] };

export const MAX_HTML = 2 * 1024 * 1024;

export function importHtml(raw: string, fallbackName = "取り込んだ画面"): Imported {
  const notes: string[] = [];
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const css = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n").trim();
  doc.querySelectorAll("style").forEach((s) => s.remove());
  const links = doc.querySelectorAll('link[rel~="stylesheet"]');
  if (links.length) notes.push(`外部の CSS（${links.length} 件）は読み込めないので外しました。見た目が要るなら CSS の欄に貼ってください`);
  const scripts = doc.querySelectorAll("script, noscript, iframe, object, embed, base, meta[http-equiv]");
  if (scripts.length) notes.push(`スクリプトなど動くもの（${scripts.length} 件）は外しました`);
  scripts.forEach((s) => s.remove());
  let handlers = 0;
  doc.body.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.toLowerCase().startsWith("on") || ((a.name === "href" || a.name === "src" || a.name === "action") && v.startsWith("javascript:"))) {
        el.removeAttribute(a.name);
        handlers += 1;
      }
    }
  });
  if (handlers) notes.push(`イベントの属性・javascript: のリンク（${handlers} 件）は外しました`);
  const html = doc.body.innerHTML.trim();
  if (!html) notes.push("body の中身がありません");
  const name = (doc.title || fallbackName).trim().slice(0, 120) || fallbackName;
  return { name, html, css, notes };
}
