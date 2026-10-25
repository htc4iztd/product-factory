export const TICKET_STATUS: Record<string, string> = {
  triage: "仕分け待ち", todo: "未着手", doing: "進行中", review: "レビュー", done: "完了", closed: "閉じた",
};
export const DECISION_STATUS: Record<string, string> = { proposed: "確定待ち", confirmed: "確定", rejected: "却下", superseded: "置き換え済み" };
export const PROVIDERS: Record<string, string> = {
  gchat: "Google Chat", gmail: "Gmail", meet: "Google Meet", teams: "Microsoft Teams", outlook: "Outlook", slack: "Slack", other: "その他",
};
export const PRIORITY_STYLE: Record<string, string> = { P1: "border-rose-200 bg-rose-50 text-rose-700", P2: "", P3: "text-zinc-400" };
