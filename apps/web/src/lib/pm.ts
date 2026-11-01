// PM の呼び名（画面のどこからでも使えるように、サーバー専用の lib/agent とは分ける）
import type { PmKey } from "./agent";

export const PM_KEYS: PmKey[] = ["pm_biz", "pm_design", "pm_impl"];
export const PM_NAME: Record<string, string> = { pm_biz: "事業PM", pm_design: "設計PM", pm_impl: "実装PM" };
