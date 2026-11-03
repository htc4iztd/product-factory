// UI デザインの部品の見た目（エディタ・AI の承認依頼の下見・レビュー・試作で共通）。AI はこのクラスを使って画面を組む。
// 落ち着いた配色・余白・角丸・影で、モックアップとしてそのまま見せられる見た目にする（外部の CSS・フォントは読まない）
export const UI_KIT_CSS = `
:root{--pf-accent:#4f46e5;--pf-accent-2:#7c3aed;--pf-ink:#18181b;--pf-sub:#52525b;--pf-mute:#a1a1aa;--pf-line:#e4e4e7;--pf-bg:#f7f7f9;--pf-card:#fff;--pf-ok:#059669;--pf-warn:#d97706;--pf-bad:#e11d48}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;color:var(--pf-ink);background:var(--pf-bg);font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
h1{font-size:26px;line-height:1.25;margin:0;letter-spacing:-.01em}h2{font-size:18px;margin:0}h3{font-size:15px;margin:0}
p{margin:0;color:var(--pf-sub)}a{color:var(--pf-accent);text-decoration:none}
.pf-app{min-height:100vh;display:flex;flex-direction:column}
.pf-nav{display:flex;align-items:center;gap:16px;padding:14px 24px;background:rgba(255,255,255,.9);border-bottom:1px solid var(--pf-line);position:sticky;top:0;backdrop-filter:blur(8px)}
.pf-nav .pf-brand{font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px}
.pf-nav .pf-links{display:flex;gap:18px;margin-left:auto;color:var(--pf-sub);font-size:13px}
.pf-main{width:100%;max-width:960px;margin:0 auto;padding:28px 24px;display:flex;flex-direction:column;gap:16px}
.pf-main.narrow{max-width:480px}
.pf-shell{display:flex;min-height:100vh}
.pf-sidebar{width:220px;flex-shrink:0;background:#fff;border-right:1px solid var(--pf-line);padding:16px 12px;display:flex;flex-direction:column;gap:2px}
.pf-sidebar a,.pf-sidebar span{display:block;padding:8px 10px;border-radius:8px;color:var(--pf-sub);font-size:13px}
.pf-sidebar .active{background:#eef2ff;color:var(--pf-accent);font-weight:600}
.pf-hero{padding:40px 28px;border-radius:20px;background:linear-gradient(135deg,#eef2ff 0%,#f5f3ff 60%,#fdf4ff 100%);display:flex;flex-direction:column;gap:12px}
.pf-hero h1{font-size:30px}.pf-hero p{font-size:15px;max-width:560px}
.pf-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 18px;border:0;border-radius:10px;background:var(--pf-accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 1px 2px rgba(79,70,229,.25)}
.pf-btn.secondary{background:#fff;color:var(--pf-ink);border:1px solid #d4d4d8;box-shadow:none}
.pf-btn.ghost{background:transparent;color:var(--pf-accent);box-shadow:none}
.pf-btn.danger{background:var(--pf-bad)}
.pf-btn.sm{padding:6px 12px;font-size:12.5px;border-radius:8px}.pf-btn.block{width:100%}
.pf-field{display:flex;flex-direction:column;gap:6px}
.pf-label{font-size:12.5px;font-weight:600;color:var(--pf-sub)}
.pf-input,.pf-select{width:100%;padding:10px 12px;border:1px solid #d4d4d8;border-radius:10px;font-size:14px;background:#fff;color:var(--pf-ink)}
.pf-help{font-size:12px;color:var(--pf-mute)}
.pf-card{background:var(--pf-card);border:1px solid var(--pf-line);border-radius:16px;padding:18px;box-shadow:0 1px 2px rgba(24,24,27,.04),0 4px 16px rgba(24,24,27,.04);display:flex;flex-direction:column;gap:8px}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.pf-row{display:flex;gap:14px;align-items:stretch}.pf-row>*{flex:1}
.pf-stack{display:flex;flex-direction:column;gap:10px}
.pf-between{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pf-list{list-style:none;margin:0;padding:0;border:1px solid var(--pf-line);border-radius:14px;background:#fff;overflow:hidden}
.pf-list li{padding:13px 16px;border-top:1px solid #f4f4f5;display:flex;align-items:center;gap:12px}.pf-list li:first-child{border-top:0}
.pf-badge{display:inline-flex;align-items:center;width:fit-content;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;background:#eef2ff;color:var(--pf-accent)}
.pf-badge.ok{background:#ecfdf5;color:var(--pf-ok)}.pf-badge.warn{background:#fffbeb;color:var(--pf-warn)}.pf-badge.bad{background:#fff1f2;color:var(--pf-bad)}
.pf-chip{display:inline-flex;width:fit-content;padding:5px 12px;border-radius:999px;border:1px solid var(--pf-line);background:#fff;font-size:12.5px;color:var(--pf-sub)}
.pf-stat{display:flex;flex-direction:column;gap:2px}.pf-stat .num{font-size:26px;font-weight:700;letter-spacing:-.02em}.pf-stat .cap{font-size:12px;color:var(--pf-mute)}
.pf-avatar{width:36px;height:36px;border-radius:999px;background:linear-gradient(135deg,#c7d2fe,#e9d5ff);display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:#3730a3;flex-shrink:0}
.pf-table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--pf-line);border-radius:14px;overflow:hidden;font-size:13px}
.pf-table th{text-align:left;font-size:12px;color:var(--pf-mute);font-weight:600;background:#fafafa;padding:10px 14px}
.pf-table td{padding:11px 14px;border-top:1px solid #f4f4f5}
.pf-progress{height:8px;border-radius:999px;background:#eef2ff;overflow:hidden}.pf-progress>i{display:block;height:100%;background:linear-gradient(90deg,var(--pf-accent),var(--pf-accent-2))}
.pf-empty{padding:36px;text-align:center;border:1.5px dashed #d4d4d8;border-radius:16px;color:var(--pf-mute)}
.pf-muted{color:var(--pf-mute);font-size:12.5px}
.pf-divider{height:1px;background:var(--pf-line);border:0;margin:4px 0}
.pf-tabbar{position:sticky;bottom:0;display:flex;justify-content:space-around;padding:10px 8px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--pf-line);font-size:11.5px;color:var(--pf-sub)}
.pf-tabbar .active{color:var(--pf-accent);font-weight:600}
.pf-footer{padding:20px 24px;color:var(--pf-mute);font-size:12px;text-align:center}
`;

export const srcDoc = (html: string, css: string, extra = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${UI_KIT_CSS}</style><style id="pf-page-css">${css}</style>${extra}</head><body>${html}</body></html>`;
