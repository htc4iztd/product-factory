"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Send } from "lucide-react";
import { talkPm } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "./Avatar";

type Item =
  | { kind: "go"; label: string; href: string; hint: string; keys: string }
  | { kind: "say"; label: string; to: string; agent: string; text: string; stage?: string };

// 話して移動する：⌘K（どこからでも）。言葉で行き先を探すか、そのまま PM に話しかける（PdM が話せるのは PM だけ。
// 工程の名前・番号が出てきたら、その工程の領域の PM に「その工程について」話す）。
// 読み違えないよう、行き先も話しかける相手も候補として見せ、選んだものだけを実行する
export function CommandBar({ pid, places, agents, stages, versions }: {
  pid: string; places: { label: string; href: string; hint: string; keys: string }[];
  agents: { key: string; name: string; keys: string }[]; stages: { id: string; label: string; keys: string; pm: string }[];
  versions: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((x) => !x); }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pf:command", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pf:command", onOpen); };
  }, []);
  useEffect(() => { if (open) { setTimeout(() => input.current?.focus(), 10); setIdx(0); setMsg(null); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const t = q.trim();
    const low = t.toLowerCase();
    // 「@事業PM」「@⑨」で宛先を決める。工程が出てきたら、その工程の領域の PM にその工程について話す
    const at = t.match(/^@(\S+)\s*(.*)$/);
    const hit = (keys: string) => keys.split(" ").some((k) => k && (at ? at[1].includes(k) || k.includes(at[1]) : t.includes(k)));
    const stage = stages.find((s) => hit(s.keys));
    const pm = agents.find((a) => hit(a.keys));
    const body = at ? at[2] : t;
    const go: Item[] = places.filter((p) => !t || (p.label + p.keys).toLowerCase().includes(low) || low.split(/\s+/).some((w) => w && (p.label + p.keys).toLowerCase().includes(w)))
      .slice(0, t ? 6 : 8).map((p) => ({ kind: "go", ...p }));
    if (!body) return go;
    const say: Item[] = [];
    if (stage) {
      const a = agents.find((x) => x.key === stage.pm)!;
      say.push({ kind: "say", label: `${a.name}に話す（${stage.label}について）`, to: a.key, agent: a.key, text: body, stage: stage.id });
    }
    for (const a of pm ? [pm] : agents) {
      if (!say.some((x) => x.kind === "say" && x.to === a.key)) say.push({ kind: "say", label: `${a.name}に話す`, to: a.key, agent: a.key, text: body });
    }
    return at ? [...say, ...go] : [...go.slice(0, 3), ...say, ...go.slice(3)];
  }, [q, places, agents, stages]);

  function run(it: Item) {
    if (it.kind === "go") { setOpen(false); setQ(""); router.push(it.href); return; }
    start(async () => {
      const r = await talkPm(pid, it.to, it.text, { stage_id: it.stage });
      if (r.error) return setMsg(r.error);
      setQ("");
      setMsg(`${it.label.replace(/に話す.*/, "")}が答えました${r.issues?.length ? `（Issue ${r.issues.map((n) => `#${n}`).join("、")} を起票）` : ""}。ダッシュボードか PM の作業場所で読めます`);
      router.refresh();
    });
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-zinc-900/30 px-4 pt-[12vh] backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="話しかける・移動する">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <input ref={input} value={q} aria-label="話しかける・移動する" placeholder="行き先を探す・PM に話しかける（@⑨ ER図に申込日時を足して → 設計PMへ）"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-zinc-400"
            onChange={(e) => { setQ(e.target.value); setIdx(0); setMsg(null); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && items[idx] && !e.nativeEvent.isComposing) { e.preventDefault(); run(items[idx]); }
            }} />
          <span className="kbd">Esc</span>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {items.map((it, i) => (
            <li key={i} role="option" aria-selected={i === idx}>
              <button onMouseEnter={() => setIdx(i)} onClick={() => run(it)} disabled={pending}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] ${i === idx ? "bg-brand-50" : ""}`}>
                {it.kind === "say" ? <Avatar k={it.agent} v={versions[it.agent]} size={24} /> : <ArrowRight size={14} className="text-zinc-400" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{it.label}</span>
                  <span className="block truncate text-[11px] text-zinc-500">{it.kind === "say" ? `「${it.text}」` : it.hint}</span>
                </span>
                {it.kind === "say" ? <Send size={13} className="text-brand-600" /> : i === idx && <CornerDownLeft size={13} className="text-zinc-400" />}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-3 text-[12px] text-zinc-400">見つかりません</li>}
        </ul>
        {(msg || pending) && <div className="border-t border-zinc-100 px-4 py-2 text-[12px] text-zinc-600">{pending ? "送っています…" : msg}</div>}
      </div>
    </div>
  );
}
