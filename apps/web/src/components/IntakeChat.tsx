"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { createFromIntake, intakeTurn, type IntakeDraft, type IntakeMsg } from "@/app/(app)/new/actions";

const EMPTY: IntakeDraft = { name: "", idea: "", scope: "", customer_segments: [], problem: [], solution: [], uvp: "" };
const LISTS = [["customer_segments", "誰のためか"], ["problem", "困りごと"], ["solution", "解決のしかた"]] as const;

// AI の聞き取りで新しいプロダクトを作る。右の内容は AI の答えで埋まり、人が書き換えた項目は上書きしない
export function IntakeChat() {
  const [msgs, setMsgs] = useState<IntakeMsg[]>([]);
  const [draft, setDraft] = useState<IntakeDraft>(EMPTY);
  const [touched, setTouched] = useState<Set<keyof IntakeDraft>>(new Set());
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [creating, startCreate] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const begun = useRef(false);

  function turn(next: IntakeMsg[]) {
    start(async () => {
      const r = await intakeTurn(next);
      setMsgs([...next, { role: "assistant", text: r.reply }]);
      if ("ready" in r && !r.error) {
        setReady(r.ready);
        setDraft((d) => {
          const out = { ...d };
          for (const k of Object.keys(EMPTY) as (keyof IntakeDraft)[]) {
            const v = r[k];
            if (!touched.has(k) && (Array.isArray(v) ? v.length : v)) (out as Record<string, unknown>)[k] = v;
          }
          return out;
        });
      }
    });
  }
  useEffect(() => {
    if (begun.current) return;
    begun.current = true;
    turn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs, pending]);

  function send() {
    const t = text.trim();
    if (!t || pending) return;
    setText("");
    const next = [...msgs, { role: "user" as const, text: t }];
    setMsgs(next);
    turn(next);
  }
  function edit<K extends keyof IntakeDraft>(k: K, v: IntakeDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setTouched((s) => new Set(s).add(k));
  }
  const canCreate = draft.name.trim() && draft.idea.trim();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-label="AI との対話" className="card flex h-[65vh] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2"}>
              {m.role === "assistant" && <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white"><Sparkles size={12} /></div>}
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3.5 py-2 text-[13px] leading-relaxed ${m.role === "user" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800"}`}>{m.text}</div>
            </div>
          ))}
          {pending && <div className="pl-8 text-xs text-zinc-400">考えています…</div>}
          <div ref={bottom} />
        </div>
        <div className="border-t border-zinc-200 p-3">
          <div className="flex items-end gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="返事"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              className="input flex-1 resize-none" placeholder="思いついたままで大丈夫です（⌘+Enter で送信）" />
            <button onClick={send} disabled={pending || !text.trim()} className="btn-primary h-9 w-9 p-0" aria-label="送信"><ArrowUp size={16} /></button>
          </div>
        </div>
      </section>

      <aside aria-label="分かったこと" className="card h-fit space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold">分かったこと</div>
          {ready ? <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">作れます</span> : <span className="chip">聞き取り中</span>}
        </div>
        <div><label className="label" htmlFor="in-name">プロダクト名</label><input id="in-name" value={draft.name} onChange={(e) => edit("name", e.target.value)} className="input" /></div>
        <div><label className="label" htmlFor="in-idea">作るもの</label><textarea id="in-idea" value={draft.idea} onChange={(e) => edit("idea", e.target.value)} rows={3} className="input" /></div>
        {LISTS.map(([k, label]) => (
          <div key={k}>
            <label className="label" htmlFor={`in-${k}`}>{label}</label>
            <textarea id={`in-${k}`} value={draft[k].join("\n")} rows={Math.max(2, draft[k].length + 1)} placeholder="1行に1つ"
              onChange={(e) => edit(k, e.target.value.split("\n").filter((x, i, a) => x.trim() || i === a.length - 1))} className="input" />
          </div>
        ))}
        <div><label className="label" htmlFor="in-uvp">選ばれる理由</label><input id="in-uvp" value={draft.uvp} onChange={(e) => edit("uvp", e.target.value)} className="input" /></div>
        <fieldset>
          <legend className="label">進め方</legend>
          <div className="grid grid-cols-2 gap-2">
            {[["mvp", "MVP", "全工程を使う"], ["poc", "PoC", "市場・競合分析を閉じる"]].map(([v, t, d]) => (
              <label key={v} className={`cursor-pointer rounded-lg border p-2.5 text-[13px] ${(draft.scope || "mvp") === v ? "border-brand-500 ring-4 ring-brand-100" : "border-zinc-200"}`}>
                <input type="radio" name="scope" value={v} checked={(draft.scope || "mvp") === v} onChange={() => edit("scope", v)} className="sr-only" />
                <div className="font-medium">{t}</div><div className="text-[11px] text-zinc-500">{d}</div>
              </label>
            ))}
          </div>
        </fieldset>
        <button disabled={!canCreate || creating} className="btn-primary w-full"
          onClick={() => startCreate(async () => {
            const r = await createFromIntake({ ...draft, customer_segments: draft.customer_segments.filter((x) => x.trim()),
              problem: draft.problem.filter((x) => x.trim()), solution: draft.solution.filter((x) => x.trim()) });
            if (r?.error) setErr(r.error);
          })}>
          {creating ? "作成中…" : "この内容でプロダクトをつくる"}
        </button>
        {!canCreate && <p className="text-[11px] text-zinc-400">プロダクト名と作るものが決まると作れます。</p>}
        {err && <p className="text-xs text-rose-600">{err}</p>}
      </aside>
    </div>
  );
}
