import Link from "next/link";
import { Hash, Link2, MessageSquare, Plus, X } from "lucide-react";
import { agent, type Channel, type Decision, type Post } from "@/lib/agent";
import { ActionForm } from "@/components/team/ActionForm";
import { RefText, when } from "@/components/team/RefText";
import { DECISION_STATUS, PROVIDERS } from "@/components/team/labels";
import { ExtractButton } from "@/components/team/ExtractButton";
import { createChannel, importPosts, postMessage } from "../team-actions";

type Thread = { root: Post; replies: Post[]; decisions: Decision[] };

function PostView({ pid, p, href }: { pid: string; p: Post; href?: string }) {
  return (
    <div className="group px-1 py-2 text-[13px]">
      <div className="mb-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
        <span className={`font-medium ${p.author === "ai" ? "text-brand-700" : "text-zinc-700"}`}>{p.author === "ai" ? "AI" : p.author}</span>
        <span>{when(p.created_at)}</span>
        {p.source?.provider && <span className="chip">{PROVIDERS[p.source.provider] ?? p.source.provider}</span>}
        {p.source?.url && <a href={p.source.url} target="_blank" rel="noreferrer" className="hover:text-zinc-600"><Link2 size={11} /></a>}
      </div>
      <div className="whitespace-pre-wrap leading-relaxed text-zinc-800"><RefText pid={pid} text={p.body} /></div>
      {href && (
        <Link href={href} className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline">
          <MessageSquare size={11} />{p.replies ? `返信 ${p.replies}件` : "スレッドで返信"}
        </Link>
      )}
    </div>
  );
}

export default async function TalkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string; t?: string; new?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const channels = await agent<Channel[]>(`/products/${id}/channels`);
  const ch = channels.find((c) => c.id === sp.c) ?? channels[0];
  const { posts } = await agent<{ posts: Post[] }>(`/products/${id}/channels/${ch.id}/posts`);
  const tid = Number(sp.t);
  const thread = tid ? await agent<Thread>(`/products/${id}/threads/${tid}`).catch(() => null) : null;
  const base = `/p/${id}/talk?c=${ch.id}`;

  return (
    <div className="flex h-screen min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white" aria-label="チャンネル">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <span className="text-[13px] font-semibold">議論</span>
          <Link href={`${base}&new=1`} className="btn-ghost btn-sm px-1" aria-label="チャンネルを作る"><Plus size={14} /></Link>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {channels.map((c) => (
            <Link key={c.id} href={`/p/${id}/talk?c=${c.id}`}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] ${c.id === ch.id ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-50"}`}>
              <Hash size={13} className="shrink-0 text-zinc-400" /><span className="truncate">{c.name}</span>
              {c.external && <span className="ml-auto shrink-0 text-[10px] text-zinc-400">{PROVIDERS[c.external.provider]}</span>}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label={`#${ch.name}`}>
        <header className="border-b border-zinc-200 bg-white px-6 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold">#{ch.name}</h1>
            {ch.external && (
              <span className="chip">{PROVIDERS[ch.external.provider]}・{ch.external.mode === "copy" ? "本文ごと取り込む" : "要約と決定だけ残す"}</span>
            )}
            {ch.external?.url && <a href={ch.external.url} target="_blank" rel="noreferrer" className="text-xs text-zinc-400 hover:text-zinc-700"><Link2 size={12} /></a>}
          </div>
          {ch.topic && <p className="text-xs text-zinc-500">{ch.topic}</p>}
        </header>

        {sp.new ? (
          <div className="mx-auto w-full max-w-xl p-6">
            <h2 className="mb-3 text-[15px] font-semibold">チャンネルを作る</h2>
            <ActionForm action={createChannel.bind(null, id)} submit="作成">
              <div><label className="label" htmlFor="ch-name">名前</label><input id="ch-name" name="name" className="input" placeholder="例：決済" required /></div>
              <div><label className="label" htmlFor="ch-topic">話題</label><input id="ch-topic" name="topic" className="input" /></div>
              <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3">
                <legend className="px-1 text-xs text-zinc-500">外部の会話とつなぐ（任意）</legend>
                <div><label className="label" htmlFor="ch-prov">つなぐ先</label>
                  <select id="ch-prov" name="provider" className="input"><option value="">つながない（このアプリで話す）</option>
                    {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label className="label" htmlFor="ch-mode">取り込み方</label>
                  <select id="ch-mode" name="mode" className="input" defaultValue="summary">
                    <option value="summary">要約と決定だけ残す（本文は元の場所に置いたまま）</option>
                    <option value="copy">本文ごと取り込む（AI が横断して読める）</option>
                  </select></div>
                <div><label className="label" htmlFor="ch-url">元の会話の URL</label><input id="ch-url" name="url" className="input" placeholder="https://..." /></div>
                <p className="text-[11px] leading-5 text-zinc-500">いまは会話を貼り付けて取り込みます。Google Workspace・Microsoft 365 からの自動の取り込みは、この設定のまま後から足します。</p>
              </fieldset>
            </ActionForm>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {posts.length === 0 && <p className="py-8 text-center text-[13px] text-zinc-400">まだ発言がありません。決まったことは「決定：〜」と書くと、AI が拾いやすくなります。</p>}
              <div className="divide-y divide-zinc-100">
                {posts.map((p) => <PostView key={p.id} pid={id} p={p} href={`${base}&t=${p.id}`} />)}
              </div>
            </div>
            <div className="space-y-2 border-t border-zinc-200 bg-white px-6 py-3">
              {ch.external && (
                <details>
                  <summary className="cursor-pointer text-xs text-zinc-500">{PROVIDERS[ch.external.provider]} の会話を貼り付けて取り込む</summary>
                  <ActionForm action={importPosts.bind(null, id, ch.id)} submit="取り込む" pendingLabel="取り込み中…" className="mt-2 space-y-2">
                    <textarea name="text" aria-label="取り込む会話" rows={6} className="input font-mono text-[12px]" placeholder={"1行に1発言。「名前: 本文」の形なら名前を発言者にします\n田中: 決済はカードだけでいい？\n佐藤: 決定：最初はカードのみ"} required />
                  </ActionForm>
                </details>
              )}
              <ActionForm action={postMessage.bind(null, id, ch.id, null)} submit="送信" className="space-y-2">
                <textarea name="body" aria-label="発言" rows={2} className="input" placeholder={`#${ch.name} に書く（@メールアドレス で知らせる・US-03 のように ID を書くとリンク）`} required />
              </ActionForm>
            </div>
          </>
        )}
      </section>

      {thread && (
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-zinc-200 bg-white" aria-label="スレッド">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <span className="text-[13px] font-semibold">スレッド</span>
            <Link href={base} className="btn-ghost btn-sm px-1" aria-label="スレッドを閉じる"><X size={14} /></Link>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <PostView pid={id} p={thread.root} />
            <div className="ml-2 divide-y divide-zinc-100 border-l-2 border-zinc-100 pl-3">
              {thread.replies.map((p) => <PostView key={p.id} pid={id} p={p} />)}
            </div>
            <div className="mt-4 space-y-2 rounded-lg bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600">このスレッドの決定</span>
                <ExtractButton pid={id} postId={thread.root.id} />
              </div>
              {thread.decisions.length === 0 ? <p className="text-[11px] text-zinc-400">まだありません。AI が会話から「決まったこと」と「宿題」を抜き出し、決定記録（確定待ち）とチケット（仕分け待ち）にします。</p>
                : thread.decisions.map((d) => (
                  <Link key={d.key} href={`/p/${id}/decisions#${d.key}`} className="block text-[12px] hover:underline">
                    <span className="font-mono text-zinc-400">{d.key}</span> {d.title} <span className="chip">{DECISION_STATUS[d.status]}</span>
                  </Link>
                ))}
            </div>
          </div>
          <div className="border-t border-zinc-200 px-4 py-3">
            <ActionForm action={postMessage.bind(null, id, ch.id, thread.root.id)} submit="返信">
              <textarea name="body" aria-label="返信" rows={2} className="input" required />
            </ActionForm>
          </div>
        </aside>
      )}
    </div>
  );
}
