"use client";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, BookOpen, Plus, RotateCcw, Save, Trash2, Wrench } from "lucide-react";
import type { AgentCatalog, CastAgent, Persona, SkillT, ToolT } from "@/lib/agent";
import { deleteSkill, saveProfile, saveSkill } from "@/app/(app)/p/[id]/cast-actions";
import { Avatar } from "@/components/rail/Avatar";

const SOURCE: Record<string, [string, string]> = {
  builtin: ["標準", "bg-zinc-100 text-zinc-600"], override: ["上書き", "bg-amber-100 text-amber-800"], custom: ["独自", "bg-violet-100 text-violet-800"],
};
const KIND: Record<string, [string, string]> = { agent: ["直結", "bg-brand-50 text-brand-700"], reference: ["参照", "bg-sky-50 text-sky-700"] };
const ROLE: Record<string, string> = { platform: "プラットフォーム", pm: "PM", stage: "工程の担当" };
const Chip = ({ t }: { t: [string, string] }) => <span className={`rounded px-1.5 text-[10.5px] font-medium ${t[1]}`}>{t[0]}</span>;

// ペルソナ・スキル・ツールの定義と割り当て（テナントで共通の配役）
export function Cast({ pid, cat, versions, canEdit }: { pid: string; cat: AgentCatalog; versions: Record<string, string>; canEdit: boolean }) {
  const [tab, setTab] = useState<"agents" | "skills" | "tools">("agents");
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="tablist">
        {([["agents", "エージェント（ペルソナと割り当て）"], ["skills", `スキル（${cat.skills.length}）`], ["tools", `ツール（${cat.tools.length}）`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${tab === k ? "border-brand-400 bg-brand-50 font-medium text-brand-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>{l}</button>
        ))}
        {!canEdit && <span className="ml-auto self-center text-[11px] text-zinc-500">変えられるのは管理者だけです（読むことはできます）</span>}
      </div>
      {tab === "agents" && <Agents pid={pid} cat={cat} versions={versions} canEdit={canEdit} />}
      {tab === "skills" && <Skills pid={pid} cat={cat} canEdit={canEdit} />}
      {tab === "tools" && <Tools tools={cat.tools} />}
    </div>
  );
}

function Agents({ pid, cat, versions, canEdit }: { pid: string; cat: AgentCatalog; versions: Record<string, string>; canEdit: boolean }) {
  const [key, setKey] = useState(cat.agents.find((a) => a.key === "s06")?.key ?? cat.agents[0].key);
  const a = cat.agents.find((x) => x.key === key)!;
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ul className="card max-h-[760px] divide-y divide-zinc-100 overflow-y-auto" aria-label="エージェント">
        {cat.agents.map((x) => (
          <li key={x.key}>
            <button onClick={() => setKey(x.key)} aria-pressed={key === x.key}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left ${key === x.key ? "bg-brand-50" : "hover:bg-zinc-50"}`}>
              <Avatar k={x.key} v={versions[x.key]} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{x.name}</span>
                <span className="block truncate text-[11px] text-zinc-500">{x.persona.title}</span>
              </span>
              {x.loadout.warnings.length > 0 && <AlertTriangle size={13} className="text-amber-500" />}
              {(x.customized.persona || x.customized.skills || x.customized.tools) && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" title="既定から変えています" />}
            </button>
          </li>
        ))}
      </ul>
      <AgentEditor key={a.key} pid={pid} a={a} cat={cat} version={versions[a.key]} canEdit={canEdit} />
    </div>
  );
}

function AgentEditor({ pid, a, cat, version, canEdit }: { pid: string; a: CastAgent; cat: AgentCatalog; version?: string; canEdit: boolean }) {
  const [persona, setPersona] = useState<Persona>(a.persona);
  const [skills, setSkills] = useState<string[]>(a.skills);
  const [tools, setTools] = useState<string[]>(a.tools);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sk = useMemo(() => Object.fromEntries(cat.skills.map((s) => [s.id, s])), [cat.skills]);
  const usable = (t: ToolT) => t.roles.includes(a.role);
  const run = (fn: () => Promise<{ error?: string }>, ok: string) => start(async () => { const r = await fn(); setMsg(r.error ?? ok); });
  const toggle = (list: string[], set: (x: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="space-y-4" aria-label={`${a.name}の設定`}>
      <section className="card p-4">
        <div className="flex items-center gap-3">
          <Avatar k={a.key} v={version} size={44} />
          <div>
            <div className="text-[15px] font-semibold">{a.name}</div>
            <div className="text-[11.5px] text-zinc-500">{ROLE[a.role]}・{persona.title}</div>
          </div>
        </div>
        <h3 className="mt-4 text-[13px] font-semibold">ペルソナ</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {(Object.keys(cat.persona_fields) as (keyof Persona)[]).map((f) => (
            <label key={f} className="block text-[11.5px] text-zinc-500">
              {cat.persona_fields[f]}
              <textarea className="input mt-0.5 text-[12.5px]" rows={f === "title" ? 1 : 2} value={persona[f] ?? ""} disabled={!canEdit} aria-label={cat.persona_fields[f]}
                onChange={(e) => setPersona({ ...persona, [f]: e.target.value })} />
            </label>
          ))}
        </div>
      </section>
      <section className="card p-4">
        <h3 className="text-[13px] font-semibold">直結するスキル</h3>
        <p className="text-[11.5px] text-zinc-500">この役割の手順と判断の基準。参照スキルは、ここで選んだスキルが参照したときだけ読み込みます（深さ {cat.limits.depth}・{cat.limits.refs} 個・{cat.limits.chars.toLocaleString()} 文字まで）。</p>
        <div className="mt-2 grid gap-1.5 md:grid-cols-2">
          {cat.skills.filter((s) => s.kind === "agent" || skills.includes(s.id)).map((s) => (
            <label key={s.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${skills.includes(s.id) ? "border-brand-300 bg-brand-50/50" : "border-zinc-200"}`}>
              <input type="checkbox" className="mt-0.5" checked={skills.includes(s.id)} disabled={!canEdit} onChange={() => toggle(skills, setSkills, s.id)} aria-label={`スキル ${s.name}`} />
              <span className="min-w-0"><span className="font-medium">{s.name}</span> <Chip t={SOURCE[s.source]} />
                <span className="block text-[11px] text-zinc-500">{s.description}</span>
                {s.refs.length > 0 && <span className="block text-[10.5px] text-sky-700">参照：{s.refs.map((r) => sk[r]?.name ?? r).join("・")}</span>}
              </span>
            </label>
          ))}
        </div>
      </section>
      <section className="card p-4">
        <h3 className="text-[13px] font-semibold">使ってよいツール</h3>
        <p className="text-[11.5px] text-zinc-500">使えるのは「ここで許したツール」のうち「読み込んだスキルが使うと書いたもの」だけです。書くツールは、AI が最後に出した内容をコードが検証してから実行します。</p>
        {(["read", "write"] as const).map((kind) => (
          <div key={kind} className="mt-2">
            <div className="text-[11.5px] font-medium text-zinc-600">{kind === "read" ? "読む（AI が必要なときに呼ぶ）" : "書く（検証してからコードが実行）"}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {cat.tools.filter((t) => t.kind === kind).map((t) => (
                <label key={t.name} title={usable(t) ? t.description : `${ROLE[a.role]}には割り当てられません`}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] ${!usable(t) ? "border-zinc-100 text-zinc-300" : tools.includes(t.name) ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-zinc-200 text-zinc-600"}`}>
                  <input type="checkbox" checked={tools.includes(t.name)} disabled={!canEdit || !usable(t)} onChange={() => toggle(tools, setTools, t.name)} aria-label={`ツール ${t.label}`} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section className="card p-4" aria-label="実行のときに読み込むもの">
        <h3 className="text-[13px] font-semibold">実行のときに読み込むもの（保存した内容）</h3>
        <div className="mt-2 grid gap-3 text-[12px] md:grid-cols-2">
          <div>
            <div className="text-[11px] text-zinc-500">スキル（直結 → 参照）</div>
            <ul className="mt-1 space-y-0.5">
              {a.loadout.agent_skills.map((s) => <li key={s}><Chip t={KIND.agent} /> {sk[s]?.name ?? s}</li>)}
              {a.loadout.ref_skills.map((s) => <li key={s} className="pl-3"><Chip t={KIND.reference} /> {sk[s]?.name ?? s}</li>)}
            </ul>
          </div>
          <div className="space-y-1">
            <div><span className="text-[11px] text-zinc-500">先に読む：</span>{a.loadout.prefetch.join("、") || "なし"}</div>
            <div><span className="text-[11px] text-zinc-500">AI が呼べる：</span>{a.loadout.reads.join("、") || "なし"}</div>
            <div><span className="text-[11px] text-zinc-500">書ける：</span>{a.loadout.writes.join("、") || "なし"}</div>
            <div className="text-[11px] text-zinc-500">指示の長さ：{a.loadout.chars.toLocaleString()} 文字</div>
          </div>
        </div>
        {a.loadout.warnings.length > 0 && (
          <ul className="mt-2 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
            {a.loadout.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </section>
      {canEdit && (
        <div className="flex items-center gap-2">
          <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(() => saveProfile(pid, a.key, { persona: persona as unknown as Record<string, string>, skills, tools }), "保存しました")}><Save size={12} />保存する</button>
          <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(() => saveProfile(pid, a.key, { reset: true }), "既定に戻しました")}><RotateCcw size={12} />既定に戻す</button>
          {msg && <span className="text-[12px] text-zinc-600">{msg}</span>}
        </div>
      )}
    </div>
  );
}

const EMPTY: SkillT = { id: "", name: "", kind: "reference", description: "", refs: [], tools: [], prefetch: [], body: "", source: "custom", used_by: [], referenced_by: [] };

function Skills({ pid, cat, canEdit }: { pid: string; cat: AgentCatalog; canEdit: boolean }) {
  const [sel, setSel] = useState<string>(cat.skills[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const s = creating ? EMPTY : cat.skills.find((x) => x.id === sel) ?? EMPTY;
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="card max-h-[760px] overflow-y-auto">
        {canEdit && <button className="btn-secondary btn-sm m-2" onClick={() => { setCreating(true); setNote(null); }}><Plus size={12} />スキルを作る</button>}
        {(["agent", "reference"] as const).map((k) => (
          <div key={k}>
            <div className="section-title px-3 pt-2">{k === "agent" ? "エージェントに直結するスキル" : "参照スキル"}</div>
            <ul className="divide-y divide-zinc-100">
              {cat.skills.filter((x) => x.kind === k).map((x) => (
                <li key={x.id}>
                  <button onClick={() => { setSel(x.id); setCreating(false); }} aria-pressed={!creating && sel === x.id}
                    className={`w-full px-3 py-1.5 text-left text-[12.5px] ${!creating && sel === x.id ? "bg-brand-50" : "hover:bg-zinc-50"}`}>
                    <span className="flex items-center gap-1.5"><span className="truncate font-medium">{x.name}</span><Chip t={SOURCE[x.source]} /></span>
                    <span className="block truncate text-[10.5px] text-zinc-500">{x.id}{x.used_by.length ? `・${x.used_by.length} 人が使用` : ""}{x.referenced_by.length ? `・${x.referenced_by.length} 件から参照` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {note && <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-800" role="status">{note}</p>}
        <SkillEditor key={creating ? "new" : s.id} pid={pid} s={s} isNew={creating} cat={cat} canEdit={canEdit}
          onSaved={(id, m) => { setCreating(false); setSel(id); setNote(m); }} />
      </div>
    </div>
  );
}

function SkillEditor({ pid, s, isNew, cat, canEdit, onSaved }: { pid: string; s: SkillT; isNew: boolean; cat: AgentCatalog; canEdit: boolean; onSaved: (id: string, msg: string) => void }) {
  const [d, setD] = useState({ ...s });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (k: "refs" | "tools" | "prefetch", v: string) => setD({ ...d, [k]: d[k].includes(v) ? d[k].filter((x) => x !== v) : [...d[k], v] });
  const save = () => start(async () => {
    const r = await saveSkill(pid, d.id, { name: d.name, kind: d.kind, description: d.description, refs: d.refs, tools: d.tools, prefetch: d.prefetch.filter((p) => d.tools.includes(p)), body: d.body });
    if (r.error) setMsg(r.error); else onSaved(d.id, s.source === "builtin" && !isNew ? "標準を上書きしました" : "保存しました");
  });
  const del = () => start(async () => {
    const r = await deleteSkill(pid, s.id);
    if (r.error) setMsg(r.error); else onSaved(s.id, s.source === "override" ? "標準に戻しました" : "消しました");
  });
  const ro = !canEdit;
  return (
    <section className="card space-y-3 p-4" aria-label="スキルの編集">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen size={15} className="text-brand-600" />
        <h3 className="text-[14px] font-semibold">{isNew ? "新しいスキル" : s.name}</h3>
        {!isNew && <Chip t={SOURCE[s.source]} />}
        {!isNew && s.used_by.length > 0 && <span className="text-[11px] text-zinc-500">使っている：{s.used_by.join("、")}</span>}
        {!isNew && s.referenced_by.length > 0 && <span className="text-[11px] text-zinc-500">参照元：{s.referenced_by.join("、")}</span>}
      </div>
      {s.source === "builtin" && !isNew && canEdit && <p className="text-[11.5px] text-amber-700">標準スキルです。保存するとこのテナントだけで上書きします（消すと標準に戻ります）。</p>}
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-[11.5px] text-zinc-500">id（英小文字・数字・ハイフン）<input className="input mt-0.5 text-[12.5px]" value={d.id} disabled={!isNew || ro} aria-label="スキルの id" onChange={(e) => setD({ ...d, id: e.target.value })} /></label>
        <label className="text-[11.5px] text-zinc-500">名前<input className="input mt-0.5 text-[12.5px]" value={d.name} disabled={ro} aria-label="スキルの名前" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="text-[11.5px] text-zinc-500">種類
          <select className="input mt-0.5 text-[12.5px]" value={d.kind} disabled={ro} aria-label="スキルの種類" onChange={(e) => setD({ ...d, kind: e.target.value as SkillT["kind"] })}>
            <option value="agent">エージェントに直結</option><option value="reference">参照スキル</option>
          </select>
        </label>
      </div>
      <label className="block text-[11.5px] text-zinc-500">説明（何のためのスキルか）<input className="input mt-0.5 text-[12.5px]" value={d.description} disabled={ro} aria-label="スキルの説明" onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
      <label className="block text-[11.5px] text-zinc-500">本文（手順・判断の基準。{d.body.length.toLocaleString()} / 8,000 文字。長くなるなら参照スキルに分けます）
        <textarea className="input mt-0.5 font-mono text-[12px]" rows={10} value={d.body} disabled={ro} aria-label="スキルの本文" onChange={(e) => setD({ ...d, body: e.target.value })} />
      </label>
      <div>
        <div className="text-[11.5px] font-medium text-zinc-600">参照するスキル</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {cat.skills.filter((x) => x.id !== d.id).map((x) => (
            <label key={x.id} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${d.refs.includes(x.id) ? "border-sky-300 bg-sky-50" : "border-zinc-200 text-zinc-600"}`}>
              <input type="checkbox" checked={d.refs.includes(x.id)} disabled={ro} onChange={() => toggle("refs", x.id)} aria-label={`参照 ${x.name}`} />{x.name}
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11.5px] font-medium text-zinc-600">このスキルが使うツール（読むツールは「先に読む」にもできる）</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {cat.tools.map((t) => (
            <span key={t.name} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${d.tools.includes(t.name) ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 text-zinc-600"}`}>
              <label className="flex items-center gap-1"><input type="checkbox" checked={d.tools.includes(t.name)} disabled={ro} onChange={() => toggle("tools", t.name)} aria-label={`使う ${t.label}`} />{t.label}</label>
              {t.kind === "read" && d.tools.includes(t.name) && (
                <label className="ml-1 flex items-center gap-0.5 text-[10.5px] text-zinc-500"><input type="checkbox" checked={d.prefetch.includes(t.name)} disabled={ro} onChange={() => toggle("prefetch", t.name)} />先に読む</label>
              )}
            </span>
          ))}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <button className="btn-primary btn-sm" disabled={pending || !d.id || !d.name} onClick={save}><Save size={12} />保存する</button>
          {!isNew && s.source !== "builtin" && <button className="btn-secondary btn-sm" disabled={pending} onClick={del}><Trash2 size={12} />{s.source === "override" ? "標準に戻す" : "消す"}</button>}
          {msg && <span className="text-[12px] text-zinc-600">{msg}</span>}
        </div>
      )}
    </section>
  );
}

function Tools({ tools }: { tools: ToolT[] }) {
  return (
    <section className="card" aria-label="ツール">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <Wrench size={14} className="text-zinc-500" />
        <h3 className="text-[14px] font-semibold">ツール（固定のロジック。スキルが名前で呼ぶ）</h3>
      </div>
      <table className="w-full text-[12px]">
        <thead className="text-left text-[11px] text-zinc-500"><tr><th className="px-4 py-1.5">名前</th><th>種類</th><th>何をするか</th><th>割り当てられる役割</th></tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {tools.map((t) => (
            <tr key={t.name}>
              <td className="px-4 py-1.5"><div className="font-medium">{t.label}</div><div className="font-mono text-[10.5px] text-zinc-400">{t.name}</div></td>
              <td>{t.kind === "read" ? <Chip t={["読む", "bg-sky-50 text-sky-700"]} /> : <Chip t={["書く", "bg-rose-50 text-rose-700"]} />}</td>
              <td className="pr-3 text-zinc-700">{t.description}</td>
              <td className="pr-4 text-zinc-500">{t.roles.map((r) => ROLE[r]).join("・")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
