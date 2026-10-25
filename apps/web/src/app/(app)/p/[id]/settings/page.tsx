import Link from "next/link";
import { revalidatePath } from "next/cache";
import { agent, type Overview } from "@/lib/agent";
import { GROUPS } from "@/lib/groups";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

function Switch({ on, name, value, label }: { on: boolean; name: string; value: string; label: string }) {
  return (
    <button name={name} value={value} role="switch" aria-checked={on} aria-label={label}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${on ? "bg-brand-600" : "bg-zinc-300"}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ov = await agent<Overview>(`/products/${id}`);
  const phases = Object.fromEntries(ov.phases.map((p) => [p.id, p]));

  async function update(formData: FormData) {
    "use server";
    const [sid, key, val] = String(formData.get("op")).split(":");
    const ids = sid === "*" ? ov.stages.map((s) => s.id) : [sid];
    await agent(`/products/${id}/settings`, {
      method: "PUT",
      body: { stages: Object.fromEntries(ids.map((s) => [s, { [key]: val === "1" }])) },
    });
    revalidatePath(`/p/${id}`, "layout");
  }

  return (
    <>
      <PageHeader crumbs={<span>ステージの設定</span>} title="ステージの設定"
        sub="このプロダクトで使うステージと、更新に承認を求めるかを決めます。閉じたステージは、上流としても参照されません。"
        actions={
          <form action={update} className="flex gap-2">
            <button name="op" value="*:approval_required:1" className="btn-secondary">すべて承認あり</button>
            <button name="op" value="*:approval_required:0" className="btn-secondary">すべて承認なし</button>
          </form>
        } />
      <div className="space-y-6 px-8 py-6">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="section-title mb-2">{g.title}</h2>
            <form action={update} className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <tr><th className="px-4 py-2 font-medium">ステージ</th><th className="px-4 py-2 font-medium">フレームワーク</th><th className="px-4 py-2 font-medium">状態</th><th className="w-28 px-4 py-2 font-medium">使う</th><th className="w-28 px-4 py-2 font-medium">承認</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {g.phases.flatMap((pid) => phases[pid].stages).map((sid) => {
                    const s = ov.stages.find((x) => x.id === sid)!;
                    return (
                      <tr key={sid} className={s.enabled ? "" : "bg-zinc-50/60 text-zinc-400"}>
                        <td className="px-4 py-2.5"><Link href={`/p/${id}/s/${sid}`} className="hover:underline"><span className="mr-2 text-zinc-400">{s.no}</span>{s.name}</Link></td>
                        <td className="px-4 py-2.5 text-zinc-500">{s.framework}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={s.status} enabled={s.enabled} /></td>
                        <td className="px-4 py-2.5"><Switch on={s.enabled} name="op" value={`${sid}:enabled:${s.enabled ? 0 : 1}`} label={`${s.name}を使う`} /></td>
                        <td className="px-4 py-2.5"><Switch on={s.approval_required} name="op" value={`${sid}:approval_required:${s.approval_required ? 0 : 1}`} label={`${s.name}の承認`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </form>
          </section>
        ))}
      </div>
    </>
  );
}
