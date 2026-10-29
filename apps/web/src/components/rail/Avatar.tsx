// エージェントの顔。状態は輪で出す：動いている（回る）・PdM の返事待ち（脈打つ）・止まっている（赤）
export type AgentState = "working" | "waiting" | "stuck" | "idle" | "off";
export const STATE_LABEL: Record<AgentState, string> = { working: "作業中", waiting: "PdM の返事待ち", stuck: "止まっている", idle: "待機", off: "閉じている" };

export function Avatar({ k, v, size = 28, state = "idle", title }: { k: string; v?: string; size?: number; state?: AgentState; title?: string }) {
  const ring = state === "working" ? "pf-ring-working" : state === "waiting" ? "ring-2 ring-amber-400 animate-pulse" : state === "stuck" ? "ring-2 ring-rose-500" : "ring-1 ring-black/5";
  return (
    <span className={`relative inline-flex shrink-0 rounded-full ${ring} ${state === "off" ? "opacity-40 grayscale" : ""}`} style={{ width: size, height: size }} title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/avatars/${k}?v=${v ?? "0"}`} alt="" width={size} height={size} className="h-full w-full rounded-full object-cover" loading="lazy" />
    </span>
  );
}
