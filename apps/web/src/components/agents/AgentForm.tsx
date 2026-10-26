"use client";
import { useState, useTransition } from "react";
import type { AgentSchedule, StageSummary } from "@/lib/agent";
import { saveAgent } from "@/app/(app)/p/[id]/agents/actions";

const TASK_HELP: Record<string, string> = {
  review: "選んだ工程を上流の最新版と突き合わせ、食い違い・必須の抜け・根拠のない数値・古くなった前提を探して提案します。",
  custom: "書いた指示に沿って選んだ工程を読み、提案します（例：競合の動きを踏まえて④の打ち手を見直して）。",
  research: "リサーチライブラリを更新します（記事・論点・プレーヤー・調査レポート）。",
  report: "報告資料を今の中身で作り直します（週次の報告などに）。",
};
const PRESETS = [
  { label: "平日 9:00", cron: "0 9 * * 1-5" }, { label: "毎日 9:00", cron: "0 9 * * *" },
  { label: "毎週月曜 9:00", cron: "0 9 * * 1" }, { label: "毎週金曜 18:00", cron: "0 18 * * 5" },
  { label: "毎月1日 9:00", cron: "0 9 1 * *" }, { label: "毎時", cron: "0 * * * *" },
];

// 予定を作る・直す。何を（仕事の種類と範囲）、いつ（cron）動かすか
export function AgentForm({ pid, stages, libraries, reports, a, onDone }: {
  pid: string; stages: StageSummary[]; libraries: { number: number; name: string }[]; reports: { number: number; title: string }[];
  a?: AgentSchedule; onDone?: () => void;
}) {
  const [task, setTask] = useState<AgentSchedule["task"]>(a?.task ?? "review");
  const [name, setName] = useState(a?.name ?? "");
  const [cronExpr, setCron] = useState(a?.cron ?? "0 9 * * 1-5");
  const [picked, setPicked] = useState<string[]>(a?.stages ?? []);
  const [instruction, setInstruction] = useState(a?.instruction ?? "");
  const [library, setLibrary] = useState(String(a?.params.library ?? libraries[0]?.number ?? ""));
  const [scope, setScope] = useState(a?.params.scope ?? "all");
  const [report, setReport] = useState(String(a?.params.report ?? reports[0]?.number ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const params = task === "research" ? { library: Number(library), scope } : task === "report" ? { report: Number(report) } : {};
    start(async () => {
      const r = await saveAgent(pid, a?.number ?? null, { name, task, cron: cronExpr, stages: picked, instruction, params });
      if (r.error) setError(r.error);
      else { setError(null); if (!a) { setName(""); setInstruction(""); setPicked([]); } onDone?.(); }
    });
  }

  return (
    <div className="space-y-3 text-[13px]">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block"><span className="label">仕事</span>
          <select className="input" value={task} aria-label="仕事の種類" onChange={(e) => setTask(e.target.value as AgentSchedule["task"])}>
            <option value="review">工程の見直し</option><option value="custom">自由な指示</option>
            <option value="research">リサーチライブラリの更新</option><option value="report">報告資料の作り直し</option>
          </select></label>
        <label className="block"><span className="label">名前</span>
          <input className="input" value={name} aria-label="エージェントの名前" placeholder="例：毎朝の設計チェック" onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <p className="text-[12px] text-zinc-500">{TASK_HELP[task]}</p>
      {(task === "review" || task === "custom") && (
        <div>
          <span className="label">見る工程（選ばなければ使っている工程すべて）</span>
          <div className="flex flex-wrap gap-1">
            {stages.filter((s) => s.enabled).map((s) => {
              const on = picked.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on} onClick={() => setPicked((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-brand-400 bg-brand-50 text-brand-800" : "border-zinc-200 text-zinc-600"}`}>
                  {s.no}{s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {(task === "custom" || task === "review") && (
        <label className="block"><span className="label">{task === "custom" ? "指示" : "追加の観点（任意）"}</span>
          <textarea className="input" rows={2} value={instruction} aria-label="エージェントへの指示" onChange={(e) => setInstruction(e.target.value)}
            placeholder={task === "custom" ? "例：③の競合の新しい動きを踏まえて、④の打ち手で弱くなったところを指摘して" : "例：非機能要求との整合を重点的に"} /></label>
      )}
      {task === "research" && (
        <div className="flex gap-3">
          <label className="block flex-1"><span className="label">ライブラリ</span>
            <select className="input" value={library} aria-label="更新するライブラリ" onChange={(e) => setLibrary(e.target.value)}>
              {libraries.length === 0 && <option value="">ライブラリがありません</option>}
              {libraries.map((l) => <option key={l.number} value={l.number}>RL-{l.number} {l.name}</option>)}
            </select></label>
          <label className="block w-40"><span className="label">範囲</span>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">すべて</option><option value="articles">記事だけ</option><option value="issues">論点</option>
              <option value="players">プレーヤー</option>
            </select></label>
        </div>
      )}
      {task === "report" && (
        <label className="block"><span className="label">報告資料</span>
          <select className="input" value={report} aria-label="作り直す報告資料" onChange={(e) => setReport(e.target.value)}>
            {reports.length === 0 && <option value="">報告資料がありません</option>}
            {reports.map((r) => <option key={r.number} value={r.number}>RP-{r.number} {r.title}</option>)}
          </select></label>
      )}
      <div>
        <span className="label">いつ動かすか（日本時間）</span>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p.cron} type="button" onClick={() => setCron(p.cron)}
              className={`rounded-md border px-2 py-0.5 text-[11px] ${cronExpr === p.cron ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>{p.label}</button>
          ))}
        </div>
        <input className="input font-mono" value={cronExpr} aria-label="cron" onChange={(e) => setCron(e.target.value)} />
        <span className="mt-0.5 block text-[11px] text-zinc-400">cron の書き方（分 時 日 月 曜日）。例：「30 8 * * 1-5」＝平日 8:30</span>
      </div>
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
      <button className="btn-primary" disabled={pending} onClick={submit}>{pending ? "保存中…" : a ? "予定を保存" : "予定を作る"}</button>
    </div>
  );
}
