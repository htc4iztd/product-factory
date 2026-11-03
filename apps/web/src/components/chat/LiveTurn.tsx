"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { AssistantMsg, MentionT } from "@/lib/agent";
import { Md } from "@/components/md/Md";
import { Avatar } from "@/components/rail/Avatar";

// 送ったその場の1往復（返事が届くまで）：PdM の発言をすぐ出し、答える人・していること・返事の文章を流れてくるまま出す
export type Live = {
  text: string; at: number; user: AssistantMsg | null; agent: { key: string; name: string } | null;
  steps: string[]; reply: string; error: string | null;
};
export type SendBody = { path: string; text: string; mentions: MentionT[]; attachments: number[]; material?: string; reply_to?: number | null };

// チャットのやり取りの Markdown（小さめの文字に合わせた見出し・リスト・表）
export function ChatMd({ text, caret = false }: { text: string; caret?: boolean }) {
  return (
    <div className={`space-y-1.5 break-words [&_a]:text-brand-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-2 [&_blockquote]:text-zinc-600 [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:text-[0.92em] [&_h1]:text-[1.15em] [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:text-[1.08em] [&_h2]:font-semibold [&_h3]:mt-1.5 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-zinc-900 [&_pre]:p-2 [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_table]:block [&_table]:overflow-x-auto [&_table]:text-[0.92em] [&_td]:border [&_td]:border-zinc-200 [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 ${caret ? "pf-caret" : ""}`}>
      <Md>{text}</Md>
    </div>
  );
}

// 送る：流れてくる様子を live に入れ、終わったら onDone に残った2つの発言（PdM・答え）を渡す
export function useChatSend(onDone: (mine: AssistantMsg, reply: AssistantMsg) => void) {
  const [live, setLive] = useState<Live | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const send = useCallback(async (body: SendBody): Promise<string | null> => {
    setLive({ text: body.text, at: Date.now(), user: null, agent: null, steps: [], reply: "", error: null });
    let res: Response;
    try {
      res = await fetch("/api/assistant/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setLive(null);
      return "送れませんでした（つながりを確かめてください）";
    }
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ detail: "送れませんでした" }));
      setLive(null);
      return err.detail ?? "送れませんでした";
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let failed: string | null = null;
    let finished = false;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev: { type: string; [k: string]: unknown };
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "user") setLive((l) => l && { ...l, user: ev.message as AssistantMsg });
        else if (ev.type === "route") setLive((l) => l && { ...l, agent: { key: String(ev.agent), name: String(ev.agent_name) } });
        else if (ev.type === "step") setLive((l) => l && { ...l, steps: [...l.steps, String(ev.text)] });
        else if (ev.type === "delta") setLive((l) => l && { ...l, reply: l.reply + String(ev.text) });
        else if (ev.type === "reset") setLive((l) => l && { ...l, reply: "" });
        else if (ev.type === "error") failed = String(ev.detail ?? "答えられませんでした");
        else if (ev.type === "done") { finished = true; done.current(ev.message as AssistantMsg, ev.reply as AssistantMsg); setLive(null); }
      }
    }
    if (!finished && !failed) failed = "途中で切れました（答えが届いたら、チャットに出ます）";
    // 失敗したら、届くまでの表示を消して文言を返す（入力欄に出す。残った発言は読み直しで出る）
    if (failed) setLive(null);
    return failed;
  }, []);
  const clear = useCallback(() => setLive(null), []);
  return { live, send, clear };
}

// 届くまでの1往復の表示
export function LiveTurn({ live, msgs }: { live: Live; msgs: AssistantMsg[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.round((now - live.at) / 1000));
  const userShown = live.user && msgs.some((m) => m.id === live.user!.id); // 読み直しで本物が出ていれば、仮の発言は出さない
  const last = live.steps.at(-1);
  return (
    <>
      {!userShown && (
        <li className="pf-rise flex justify-end" aria-label="送った発言">
          <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-900 px-3 py-2 text-[12.5px] text-white">{live.text}</div>
        </li>
      )}
      <li className="pf-rise flex items-start gap-2" aria-label="返事を書いています" aria-live="polite">
        {live.agent ? <Avatar k={live.agent.key} size={26} /> : <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-zinc-100"><Loader2 size={13} className="animate-spin text-zinc-400" /></span>}
        <div className="min-w-0 max-w-[88%] flex-1 rounded-2xl rounded-tl-md bg-zinc-100 px-3 py-2 text-[12.5px] text-zinc-800">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-zinc-500">
            <span className="font-medium text-zinc-700">{live.agent ? live.agent.name : "答える人を決めています"}</span>
            {!live.error && <span>{sec > 0 ? `${sec}秒` : ""}</span>}
          </div>
          {live.steps.length > 0 && (
            <details className="group mb-1 text-[11px] text-zinc-500" open={!live.reply}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 marker:hidden">
                {!live.reply && !live.error ? <Dots /> : <Check size={11} className="text-emerald-600" />}
                <span className="truncate">{live.reply ? `${live.steps.length} 個の手順を踏みました` : last}</span>
              </summary>
              <ol className="mt-1 space-y-0.5 border-l border-zinc-200 pl-2.5">
                {live.steps.map((s, i) => <li key={i} className="pf-rise">{s}</li>)}
              </ol>
            </details>
          )}
          {live.reply ? <ChatMd text={live.reply} caret={!live.error} /> : !live.steps.length && !live.error && <Dots />}
          {live.error && <div className="mt-1 text-[11.5px] text-rose-600">{live.error}</div>}
        </div>
      </li>
    </>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: `pf-dot 1s ${i * 0.15}s infinite ease-in-out` }} />)}
    </span>
  );
}
