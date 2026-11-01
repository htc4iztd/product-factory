// UI デザインの部品の見た目（エディタ・AI の承認依頼の下見・試作で共通）。AI はこのクラスを使って画面を組む
export const UI_KIT_CSS = `
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#18181b;background:#fafafa}
.pf-nav{display:flex;align-items:center;gap:12px;padding:12px 20px;background:#fff;border-bottom:1px solid #e4e4e7}
.pf-main{max-width:720px;margin:0 auto;padding:24px 20px;display:flex;flex-direction:column;gap:12px}
.pf-btn{display:inline-block;padding:10px 18px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
.pf-btn.secondary{background:#fff;color:#18181b;border:1px solid #d4d4d8}
.pf-input{width:100%;padding:10px 12px;border:1px solid #d4d4d8;border-radius:10px;font-size:14px;background:#fff}
.pf-label{font-size:12px;color:#52525b}
.pf-card{background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.pf-list{list-style:none;margin:0;padding:0;border:1px solid #e4e4e7;border-radius:12px;background:#fff}
.pf-list li{padding:12px 14px;border-top:1px solid #f4f4f5}.pf-list li:first-child{border-top:0}
.pf-row{display:flex;gap:12px}.pf-row>*{flex:1}
.pf-tabbar{position:sticky;bottom:0;display:flex;justify-content:space-around;padding:10px;background:#fff;border-top:1px solid #e4e4e7;font-size:12px}
h1{font-size:22px;margin:4px 0}h2{font-size:17px;margin:4px 0}p{margin:0;color:#3f3f46;line-height:1.6}
`;

export const UI_BLOCKS: { id: string; label: string; content: string }[] = [
  { id: "pf-nav", label: "ヘッダー", content: '<header class="pf-nav"><strong>サービス名</strong><span style="margin-left:auto">メニュー</span></header>' },
  { id: "pf-main", label: "本文の枠", content: '<main class="pf-main"><h1>見出し</h1><p>説明の文章</p></main>' },
  { id: "pf-btn", label: "ボタン", content: '<button class="pf-btn">ボタン</button>' },
  { id: "pf-input", label: "入力欄", content: '<label class="pf-label">項目名</label><input class="pf-input" placeholder="入力してください"/>' },
  { id: "pf-card", label: "カード", content: '<div class="pf-card"><h2>カードの見出し</h2><p>カードの中身</p></div>' },
  { id: "pf-list", label: "リスト", content: '<ul class="pf-list"><li>項目1</li><li>項目2</li><li>項目3</li></ul>' },
  { id: "pf-form", label: "フォーム", content: '<form class="pf-card" style="display:flex;flex-direction:column;gap:10px"><label class="pf-label">メールアドレス</label><input class="pf-input" type="email"/><label class="pf-label">パスワード</label><input class="pf-input" type="password"/><button class="pf-btn">送信</button></form>' },
  { id: "pf-row", label: "横並び（2列）", content: '<div class="pf-row"><div class="pf-card">左</div><div class="pf-card">右</div></div>' },
  { id: "pf-tabbar", label: "タブバー", content: '<nav class="pf-tabbar"><span>ホーム</span><span>記録</span><span>設定</span></nav>' },
];

export const srcDoc = (html: string, css: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${UI_KIT_CSS}${css}</style></head><body>${html}</body></html>`;
