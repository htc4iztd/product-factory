// スマホかどうか：cookie pf_view（m＝スマホ版・pc＝PC 版）。なければ端末（User-Agent）で決める
const MOBILE_UA = /iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone|webOS|BlackBerry/i;
export const isMobileUa = (ua: string | null) => MOBILE_UA.test(ua ?? "");
export function isMobile(ua: string | null, view: string | undefined): boolean {
  if (view === "m") return true;
  if (view === "pc") return false;
  return isMobileUa(ua);
}
// 見え方を切り替える（cookie を置いて読み直す）
export function switchView(v: "m" | "pc") {
  document.cookie = `pf_view=${v}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
