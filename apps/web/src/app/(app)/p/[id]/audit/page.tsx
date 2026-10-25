import { agent, type AuditRow } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";

const KIND: Record<string, string> = {
  "product.create": "プロダクト作成", "chat.user": "発言", "chat.assistant": "AIの発言", "chat.feedback": "修正指示",
  "draft.accept": "案を採用", "draft.reject": "案を却下", "draft.edit": "編集", commit: "確定", approval: "承認判断",
  completed: "確定版の更新", status: "状態の変化", settings: "設定変更", "recheck.ack": "要再確認を確認",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await agent<AuditRow[]>(`/products/${id}/audit`);
  return (
    <>
      <PageHeader crumbs={<span>監査ログ</span>} title="監査ログ" sub="追記のみ。人の発言・判断は要約せずそのまま残ります。新しい順。" />
      <div className="px-8 py-6">
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr><th className="px-4 py-2 font-medium">日時</th><th className="px-4 py-2 font-medium">工程</th><th className="px-4 py-2 font-medium">実行者</th><th className="px-4 py-2 font-medium">種類</th><th className="px-4 py-2 font-medium">版</th><th className="px-4 py-2 font-medium">内容</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-400">{new Date(r.at).toLocaleString("ja-JP")}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.stage_id ?? "—"}</td>
                  <td className="px-4 py-2"><span className={`chip ${r.actor_type === "human" ? "" : "border-transparent bg-zinc-100"}`}>{r.actor}</span></td>
                  <td className="whitespace-nowrap px-4 py-2">{KIND[r.kind] ?? <span className="font-mono text-xs">{r.kind}</span>}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.target_version ? `v${r.target_version}` : ""}</td>
                  <td className="px-4 py-2">
                    <pre className="max-w-xl whitespace-pre-wrap break-words font-sans text-xs text-zinc-600">{r.body ? JSON.stringify(r.body, null, 1) : ""}</pre>
                    {r.reason && <div className="mt-1 text-xs text-amber-700">理由：{r.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
