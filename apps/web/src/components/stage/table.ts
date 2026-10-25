import type { FieldSpec, FieldValue, Row } from "@/lib/agent";

// 表に中身が入っているか（固定行の表は見出し列を除いて見る）
export function tableFilled(field: FieldSpec, value: FieldValue): boolean {
  const rows = (value as Row[] | undefined) ?? [];
  return rows.some((r) => field.columns.slice(field.rows.length ? 1 : 0).some((c) => String(r[c.key] ?? "").trim()));
}
