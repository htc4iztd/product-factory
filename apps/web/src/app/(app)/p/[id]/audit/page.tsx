import { agent, type AuditRow } from "@/lib/agent";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await agent<AuditRow[]>(`/products/${id}/audit`);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold text-deep">監査ログ</h1>
      <p className="text-sm text-muted">追記のみ。人の回答・承認は要約せずそのまま残る。新しい順。</p>
      <table className="w-full text-sm">
        <thead className="bg-deep text-left text-white">
          <tr><th className="p-2">日時</th><th className="p-2">工程</th><th className="p-2">実行者</th><th className="p-2">種類</th><th className="p-2">版</th><th className="p-2">本文・理由</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td className="whitespace-nowrap p-2 text-xs text-muted">{new Date(r.at).toLocaleString("ja-JP")}</td>
              <td className="p-2">{r.stage_id ?? "—"}</td>
              <td className="p-2">{r.actor_type === "human" ? "👤 " : ""}{r.actor}</td>
              <td className="p-2 font-mono text-xs">{r.kind}</td>
              <td className="p-2">{r.target_version ? `v${r.target_version}` : ""}</td>
              <td className="p-2">
                <pre className="max-w-xl whitespace-pre-wrap break-words text-xs">{r.body ? JSON.stringify(r.body, null, 1) : ""}</pre>
                {r.reason && <div className="text-xs text-amber">理由：{r.reason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
