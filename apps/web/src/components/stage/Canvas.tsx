import type { FieldSpec, Row, StageDetail } from "@/lib/agent";
import { FieldEditor } from "./FieldEditor";

type Ctx = { pid: string; st: StageDetail; readOnly: boolean; proposed: Set<string> };

function F({ c, k, compact }: { c: Ctx; k: string; compact?: boolean }) {
  const f = c.st.framework.fields.find((x) => x.key === k) as FieldSpec;
  return (
    <FieldEditor pid={c.pid} sid={c.st.id} field={f} value={c.st.draft[k]} readOnly={c.readOnly}
      hasProposal={c.proposed.has(k)} compact={compact} />
  );
}

function Cell({ title, n, className = "", children }: { title?: string; n?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-3 bg-white p-3.5 ${className}`}>
      {title && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          {n && <span className="flex h-4 w-4 items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">{n}</span>}{title}
        </div>
      )}
      {children}
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

// ---------- ① リーンキャンバス ----------
function LeanCanvas({ c }: { c: Ctx }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 shadow-card lg:grid-cols-10">
      <Cell className="lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <F c={c} k="problem" compact /><F c={c} k="alternatives" compact />
      </Cell>
      <Cell className="lg:col-span-2 lg:col-start-3 lg:row-start-1"><F c={c} k="solution" compact /></Cell>
      <Cell className="lg:col-span-2 lg:col-start-3 lg:row-start-2"><F c={c} k="key_metrics" compact /></Cell>
      <Cell className="bg-gradient-to-b from-brand-50/60 to-white lg:col-span-2 lg:col-start-5 lg:row-span-2 lg:row-start-1">
        <F c={c} k="uvp" compact />
      </Cell>
      <Cell className="lg:col-span-2 lg:col-start-7 lg:row-start-1"><F c={c} k="unfair_advantage" compact /></Cell>
      <Cell className="lg:col-span-2 lg:col-start-7 lg:row-start-2"><F c={c} k="channels" compact /></Cell>
      <Cell className="lg:col-span-2 lg:col-start-9 lg:row-span-2 lg:row-start-1">
        <F c={c} k="customer_segments" compact /><F c={c} k="early_adopters" compact />
      </Cell>
      <Cell className="lg:col-span-5 lg:col-start-1 lg:row-start-3"><F c={c} k="cost" compact /></Cell>
      <Cell className="lg:col-span-5 lg:col-start-6 lg:row-start-3"><F c={c} k="revenue" compact /></Cell>
    </div>
  );
}

// ---------- ② 市場規模 ----------
function Circles({ rows }: { rows: Row[] }) {
  const by = Object.fromEntries(rows.map((r) => [String(r.tier), r]));
  const ring = [
    { k: "TAM", r: 96, fill: "#eef0fe", text: "#4547c4" },
    { k: "SAM", r: 66, fill: "#dfe2fc", text: "#4547c4" },
    { k: "SOM", r: 36, fill: "#6366f1", text: "#ffffff" },
  ];
  return (
    <svg viewBox="0 0 220 220" className="mx-auto w-full max-w-[260px]" role="img" aria-label="TAM SAM SOM">
      {ring.map((x) => <circle key={x.k} cx="110" cy={214 - x.r} r={x.r} fill={x.fill} stroke="#c9cdf7" />)}
      {ring.map((x, i) => (
        <g key={x.k + "t"}>
          <text x="110" y={214 - 2 * x.r + (i === 2 ? 34 : 18)} textAnchor="middle" fontSize="10" fontWeight="600" fill={x.text}>{x.k}</text>
          <text x="110" y={214 - 2 * x.r + (i === 2 ? 48 : 31)} textAnchor="middle" fontSize="9" fill={x.text}>{String(by[x.k]?.value ?? "") || "—"}</text>
        </g>
      ))}
    </svg>
  );
}

function Market({ c }: { c: Ctx }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <Panel className="flex items-center"><Circles rows={(c.st.draft.market_size as Row[]) ?? []} /></Panel>
        <Panel><F c={c} k="market_size" /></Panel>
      </div>
      <Panel><F c={c} k="segments" /></Panel>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel><F c={c} k="trends" /></Panel>
        <Panel><F c={c} k="review_condition" /></Panel>
      </div>
    </div>
  );
}

// ---------- ③ 競合とポジショニング ----------
const short = (t: string, n = 22) => (t.length > n ? t.slice(0, n) + "…" : t);

function PositionMap({ rows, x, y }: { rows: Row[]; x: string; y: string }) {
  const pts = rows.filter((r) => String(r.name ?? "").trim());
  const pos = (v: unknown) => 150 + Math.max(-5, Math.min(5, Number(v) || 0)) * 26;
  return (
    <svg viewBox="0 0 300 300" className="w-full" role="img" aria-label="ポジショニングマップ">
      <rect x="10" y="10" width="280" height="280" rx="12" fill="#fafafa" stroke="#e4e4e7" />
      <line x1="20" y1="150" x2="280" y2="150" stroke="#d4d4d8" />
      <line x1="150" y1="20" x2="150" y2="280" stroke="#d4d4d8" />
      <text x="280" y="164" textAnchor="end" fontSize="9" fill="#71717a">→ {short(x || "横軸")}</text>
      <text x="156" y="28" fontSize="9" fill="#71717a">↑ {short(y || "縦軸")}</text>
      {pts.map((p, i) => {
        const self = /自社|当社|us|self/i.test(String(p.name));
        return (
          <g key={i}>
            <circle cx={pos(p.x)} cy={300 - pos(p.y)} r={self ? 7 : 5} fill={self ? "#6366f1" : "#a1a1aa"} stroke="#fff" strokeWidth="2" />
            <text x={pos(p.x) + 9} y={300 - pos(p.y) + 3} fontSize="9" fontWeight={self ? 700 : 400} fill={self ? "#4547c4" : "#3f3f46"}>{short(String(p.name), 14)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Competitors({ c }: { c: Ctx }) {
  return (
    <div className="space-y-4">
      <Panel><F c={c} k="competitors" /></Panel>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <div className="mb-2 text-[13px] font-medium">ポジショニングマップ</div>
          <PositionMap rows={(c.st.draft.positions as Row[]) ?? []} x={String(c.st.draft.axis_x ?? "")} y={String(c.st.draft.axis_y ?? "")} />
          <p className="mt-1 text-[11px] text-zinc-400">軸の名前は右の項目で編集します。名前に「自社」を含む点を強調します。</p>
        </Panel>
        <Panel className="space-y-4"><F c={c} k="axis_x" /><F c={c} k="axis_y" /><F c={c} k="positions" /></Panel>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel><F c={c} k="differentiation" /></Panel>
        <Panel><F c={c} k="review_condition" /></Panel>
      </div>
    </div>
  );
}

// ---------- ④ バリュープロポジションキャンバス ----------
function Vpc({ c }: { c: Ctx }) {
  return (
    <div className="space-y-4">
      <Panel><F c={c} k="target_customer" /></Panel>
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <div>
          <div className="section-title mb-2 px-1">バリューマップ（提供する価値）</div>
          <div className="grid h-[calc(100%-1.5rem)] grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 shadow-card">
            <Cell className="row-span-2"><F c={c} k="products" compact /></Cell>
            <Cell><F c={c} k="gain_creators" compact /></Cell>
            <Cell><F c={c} k="pain_relievers" compact /></Cell>
          </div>
        </div>
        <div>
          <div className="section-title mb-2 px-1">顧客プロファイル（顧客の現実）</div>
          <div className="grid h-[calc(100%-1.5rem)] grid-cols-2 gap-px overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-200 shadow-card">
            <Cell><F c={c} k="gains" compact /></Cell>
            <Cell className="row-span-2"><F c={c} k="customer_jobs" compact /></Cell>
            <Cell><F c={c} k="pains" compact /></Cell>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="bg-gradient-to-br from-brand-50/70 to-white"><F c={c} k="north_star" /></Panel>
        <Panel><F c={c} k="exit_criteria" /></Panel>
      </div>
    </div>
  );
}

// ---------- ⑤ 事業計画 ----------
function KpiTree({ rows }: { rows: Row[] }) {
  const items = rows.filter((r) => String(r.kpi ?? "").trim());
  if (!items.length) return null;
  const names = new Set(items.map((r) => String(r.kpi)));
  const children = (p: string) => items.filter((r) => String(r.parent ?? "") === p);
  const roots = items.filter((r) => !String(r.parent ?? "").trim() || !names.has(String(r.parent)));
  const Node = ({ r, depth }: { r: Row; depth: number }) => (
    <li>
      <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${depth === 0 ? "border-brand-200 bg-brand-50" : "border-zinc-200 bg-white"}`}>
        <span className="text-[12px] font-medium">{String(r.kpi)}</span>
        {String(r.target ?? "") && <span className="ml-auto text-[11px] tabular-nums text-zinc-500">{String(r.target)}</span>}
      </div>
      {children(String(r.kpi)).length > 0 && (
        <ul className="ml-4 mt-1.5 space-y-1.5 border-l border-zinc-200 pl-3">
          {children(String(r.kpi)).map((ch, i) => <Node key={i} r={ch} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
  return <ul className="space-y-1.5">{roots.map((r, i) => <Node key={i} r={r} depth={0} />)}</ul>;
}

function plTotals(rows: Row[]) {
  const by = Object.fromEntries(rows.map((r) => [String(r.item), r]));
  const n = (v: unknown) => Number(v) || 0;
  return (["y1", "y2", "y3"] as const).map((y) => {
    const gross = n(by["売上"]?.[y]) - n(by["原価"]?.[y]);
    return { y, sales: n(by["売上"]?.[y]), gross, op: gross - n(by["販管費"]?.[y]) };
  });
}

function BusinessPlan({ c }: { c: Ctx }) {
  const totals = plTotals((c.st.draft.pl as Row[]) ?? []);
  const max = Math.max(1, ...totals.map((t) => Math.max(Math.abs(t.sales), Math.abs(t.op))));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <div className="mb-3 text-[13px] font-medium">KPIツリー</div>
          <KpiTree rows={(c.st.draft.kpi_tree as Row[]) ?? []} />
          <div className="mt-4 border-t border-zinc-100 pt-3"><F c={c} k="kpi_tree" /></div>
        </Panel>
        <div className="space-y-4">
          <Panel><F c={c} k="revenue_model" /></Panel>
          <Panel>
            <F c={c} k="pl" />
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-3">
              {totals.map((t, i) => (
                <div key={t.y}>
                  <div className="text-[11px] text-zinc-400">{i + 1}年目</div>
                  <div className="mt-1 flex h-16 items-end gap-1">
                    <div className="w-1/2 rounded-t bg-zinc-200" style={{ height: `${(Math.abs(t.sales) / max) * 100}%` }} title={`売上 ${t.sales}`} />
                    <div className={`w-1/2 rounded-t ${t.op >= 0 ? "bg-emerald-400" : "bg-rose-400"}`} style={{ height: `${(Math.abs(t.op) / max) * 100}%` }} title={`営業利益 ${t.op}`} />
                  </div>
                  <div className="mt-1 text-[11px] tabular-nums text-zinc-500">粗利 {t.gross.toLocaleString()}</div>
                  <div className={`text-[11px] font-medium tabular-nums ${t.op >= 0 ? "text-emerald-600" : "text-rose-600"}`}>営業利益 {t.op.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel><F c={c} k="investment" /></Panel>
        <Panel><F c={c} k="review_condition" /></Panel>
      </div>
    </div>
  );
}

// ---------- ⑥以降：見出しごとの文書 ----------
function DocumentView({ c }: { c: Ctx }) {
  return (
    <div className="space-y-3">
      {c.st.framework.fields.map((f) => <Panel key={f.key}><F c={c} k={f.key} /></Panel>)}
    </div>
  );
}

const VIEWS: Record<string, (p: { c: Ctx }) => React.ReactNode> = {
  lean_canvas: LeanCanvas, market: Market, competitors: Competitors, vpc: Vpc, business_plan: BusinessPlan, document: DocumentView,
};

export function Canvas({ pid, st, readOnly }: { pid: string; st: StageDetail; readOnly: boolean }) {
  const proposed = new Set(st.chat.flatMap((m) => m.proposals.filter((p) => p.status === "pending").map((p) => p.field)));
  const View = VIEWS[st.framework.view] ?? DocumentView;
  return <View c={{ pid, st, readOnly, proposed }} />;
}
