"use client";
import { useState, useTransition } from "react";
import { Check, ImagePlus, Link2, Star, Trash2, Wand2 } from "lucide-react";
import { deleteImage, generateImage, setCover } from "@/app/(app)/p/[id]/canvas/actions";

const KIND_HINT: Record<string, string> = {
  scene: "顧客がプロダクトを使っている場面（写真風）",
  ui: "スマートフォンとPCに映った画面のイメージ",
  concept: "課題 → プロダクト → 解決後 を1枚で示す図解風（3D のイラスト）",
  graphic: "顧客・課題・価値提案・ソリューションを、日本語の見出しと手描きの絵でまとめたグラレコ",
};

export function GenerateForm({ pid, kinds, model, first }: { pid: string; kinds: Record<string, string>; model: string; first: boolean }) {
  const [kind, setKind] = useState("scene");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5 rounded-lg bg-zinc-100 p-1">
        {Object.entries(kinds).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${kind === k ? "bg-white text-zinc-900 shadow-card" : "text-zinc-500 hover:text-zinc-800"}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500">{KIND_HINT[kind]}</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input"
        placeholder="追加の指示（任意）例：朝の食卓、30代の夫婦／水彩画風で。決めてある画風より優先します" aria-label="追加の指示" />
      {error && <p className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}
      <button disabled={pending} onClick={() => { setError(null); start(async () => { const r = await generateImage(pid, kind, note); if (r.error) setError(r.error); else setNote(""); }); }}
        className="btn-brand w-full">
        <Wand2 size={14} className={pending ? "animate-pulse" : ""} />
        {pending ? "生成中…（数十秒かかります）" : first ? "最初の1枚を生成する" : "生成する"}
      </button>
      <p className="text-[10px] text-zinc-400">画像モデル：{model}{model === "stub" ? "（キー未設定のため仮の画像）" : ""}。{kind === "graphic" ? "グラレコは日本語の見出しを描きます（文字が崩れることがあります）。" : "画像の中には文字を描かせません（追加の指示で変えられます）。"}</p>
    </div>
  );
}

export function ImageActions({ pid, id, isCover }: { pid: string; id: string; isCover: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? null); });
  return (
    <div className="flex items-center gap-1">
      {isCover ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600"><Star size={12} className="fill-amber-400 text-amber-400" />表紙</span>
      ) : (
        <button disabled={pending} onClick={() => run(() => setCover(pid, id))} className="btn-ghost btn-sm"><Star size={12} />表紙にする</button>
      )}
      <a href={`/api/p/${pid}/images/${id}`} download className="btn-ghost btn-sm" aria-label="ダウンロード"><ImagePlus size={12} /></a>
      <button disabled={pending} onClick={() => { if (confirm("この画像を削除しますか？")) run(() => deleteImage(pid, id)); }} className="btn-ghost btn-sm ml-auto text-zinc-400 hover:text-rose-600" aria-label="削除">
        <Trash2 size={12} />
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}

export function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <button className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(location.href); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <Check size={14} /> : <Link2 size={14} />}{done ? "コピーしました" : "リンクをコピー"}
    </button>
  );
}
