// ⑥の画面（pages）から、画面の移り方まで操作できる「1つの HTML」のプロトタイプを組む（AI を使わない、決まった組み方）。
// 左に案内（シナリオ＝ユーザーフロー・画面の一覧・設計メモ）、中央に端末の枠。端末の中の data-go・リンクで画面が移る。
import { UI_KIT_CSS } from "./uikit";

export type ProtoPage = { id: string; name: string; screen: string; html: string; css: string };
export type ProtoScreen = Record<string, string>;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

// 部品集の CSS を画面の中だけに効かせる（:root の変数は外に出す）
function kitScoped(): string {
  const root = UI_KIT_CSS.match(/:root\{[^}]*\}/)?.[0] ?? "";
  const rest = UI_KIT_CSS.replace(root, "").replace(/(^|\})\s*body\{/g, "$1:scope{");
  return `${root}\n@scope (.pf-screen) {${rest}}`;
}

// ユーザーフローの「流れ」から、通る画面を順に拾う（SC-xx か画面名）
function flowSteps(text: string, pages: ProtoPage[]): string[] {
  const hits: { at: number; id: string }[] = [];
  for (const p of pages) {
    for (const key of [p.screen, p.name].filter(Boolean)) {
      let i = text.indexOf(key);
      while (i >= 0) { hits.push({ at: i, id: p.id }); i = text.indexOf(key, i + key.length); }
    }
  }
  const out: string[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) if (out[out.length - 1] !== h.id) out.push(h.id);
  return out;
}

export function assembleProto({ product, pages, screens, flows }: {
  product: string; pages: ProtoPage[]; screens: ProtoScreen[]; flows: ProtoScreen[];
}): string {
  const memo = Object.fromEntries(pages.map((p) => {
    const s = screens.find((x) => x.id === p.screen);
    return [p.id, { title: p.name + (p.screen ? `（${p.screen}）` : ""), purpose: s?.purpose ?? "", content: s?.content ?? "", stories: s?.stories ?? "" }];
  }));
  const scenarios = flows.map((f) => ({ name: f.name || f.id, steps: flowSteps(`${f.steps ?? ""}`, pages) })).filter((f) => f.steps.length > 1).slice(0, 4);
  if (!scenarios.length) scenarios.push({ name: "すべての画面", steps: pages.map((p) => p.id) });
  const keys = Object.fromEntries(pages.flatMap((p) => [[p.id, p.id], [p.name, p.id], ...(p.screen ? [[p.screen, p.id], [p.screen.toLowerCase(), p.id]] : [])]));
  const sections = pages.map((p) => `<section class="pf-screen" data-screen="${esc(p.id)}" data-screen-name="${esc(p.name)}" hidden>${p.css ? `<style>@scope ([data-screen="${esc(p.id)}"]) {${p.css.replace(/<\/style/gi, "")}}</style>` : ""}${p.html}</section>`).join("\n");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(product)} モックアップ</title>
<style>
:root{--ground:#eceae6;--panel:#f7f6f3;--ink:#22201c;--muted:#6c6760;--line:#d8d4cc;--accent:#4f46e5;--frame:#1d1c1a;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--ground:#161513;--panel:#1f1d1a;--ink:#efebe4;--muted:#a39d93;--line:#3a3631;--frame:#050505}}
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.6 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
.app{display:grid;grid-template-columns:minmax(240px,320px) auto;gap:40px;justify-content:center;align-items:start;padding:28px 16px;max-width:1100px;margin:0 auto}
.guide{display:flex;flex-direction:column;gap:16px;min-width:0}
.guide h1{font-size:20px;line-height:1.3;margin:0}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border:1px solid var(--line);border-radius:99px;color:var(--muted)}
.seg{display:flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{flex:1;border:0;background:transparent;padding:8px;font:inherit;color:inherit;cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--ground)}
.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.steps button{width:100%;display:grid;grid-template-columns:28px 1fr;gap:6px;text-align:left;border:0;background:transparent;padding:7px 10px;border-radius:8px;font:inherit;color:inherit;cursor:pointer}
.steps .no{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}
.steps button[aria-current="step"]{background:var(--panel);box-shadow:inset 3px 0 0 var(--accent)}
.why{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.why h2{margin:0;font-size:15px}.why p{margin:0}.why .sub{font-size:12px;color:var(--muted)}
.back{align-self:flex-start;border:1px solid var(--line);background:transparent;border-radius:99px;padding:6px 14px;font:inherit;color:inherit;cursor:pointer}
.back[disabled]{opacity:.4;cursor:default}
.device{width:390px;height:800px;border-radius:52px;background:var(--frame);padding:12px;box-shadow:0 30px 60px -30px rgba(0,0,0,.45)}
.viewport{position:relative;width:100%;height:100%;border-radius:42px;background:#fff;overflow:hidden auto}
.pf-screen{min-height:100%;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:var(--pf-bg);color:var(--pf-ink);font-size:14px;line-height:1.6}
.pf-screen.enter-push{animation:pushIn .3s cubic-bezier(.2,.8,.2,1)}.pf-screen.enter-back{animation:backIn .3s cubic-bezier(.2,.8,.2,1)}
@keyframes pushIn{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
@keyframes backIn{from{transform:translateX(-40px);opacity:0}to{transform:none;opacity:1}}
.toast{position:absolute;left:16px;right:16px;bottom:24px;background:var(--ink);color:var(--ground);border-radius:12px;padding:10px 14px;font-size:13px}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
.pager{display:none}.pager select{width:100%;font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
@media (max-width:760px){.app{grid-template-columns:1fr;gap:12px;padding:0}.guide{padding:10px 16px}.steps,.why .sub{display:none}.pager{display:block}
.device{width:100%;height:calc(100dvh - 180px);min-height:520px;border-radius:0;padding:0;box-shadow:none}.viewport{border-radius:0}}
${kitScoped()}
</style></head><body>
<div class="app">
  <aside class="guide" aria-label="デモの案内">
    <div><span class="badge">モックアップ・架空のデータ</span><h1>${esc(product)}</h1></div>
    <p class="sub" style="margin:0;color:var(--muted)">画面の中のボタンを押すと次の画面へ進みます。左の一覧から好きな画面へ飛ぶこともできます。</p>
    <div class="seg" role="group" aria-label="シナリオ" id="seg"></div>
    <div class="pager"><select id="jump" aria-label="画面へ移動"></select></div>
    <ol class="steps" id="steps"></ol>
    <section class="why" aria-live="polite"><h2 id="why-title"></h2><p id="why-text"></p><p class="sub" id="why-sub"></p></section>
    <button class="back" id="back" disabled>← 前の画面</button>
  </aside>
  <div class="device"><div class="viewport" id="viewport">
${sections}
  </div></div>
</div>
<script>
const MEMO=${json(memo)}, SCEN=${json(scenarios)}, KEYS=${json(keys)};
const S={scenario:0, screen:SCEN[0].steps[0], history:[]};
const $=(id)=>document.getElementById(id);
const find=(raw)=>{const k=decodeURIComponent(String(raw||"")).trim().replace(/^#\\/?/,"").replace(/^\\.?\\//,"").replace(/\\.html?$/i,"").replace(/[?#].*$/,"");return KEYS[k]||KEYS[k.toLowerCase()]||null;};
function toast(m){const t=document.createElement("div");t.className="toast";t.textContent=m;$("viewport").appendChild(t);setTimeout(()=>t.remove(),2000);}
function show(id,anim){S.screen=id;document.querySelectorAll(".pf-screen").forEach(s=>{const on=s.dataset.screen===id;s.hidden=!on;s.classList.remove("enter-push","enter-back");if(on&&anim){void s.offsetWidth;s.classList.add("enter-"+anim);}});
$("viewport").scrollTop=0;const m=MEMO[id]||{};$("why-title").textContent=m.title||"";$("why-text").textContent=m.purpose||"";
$("why-sub").textContent=[m.content&&("主な情報・操作："+m.content),m.stories&&("ストーリー："+m.stories)].filter(Boolean).join("　");
$("back").disabled=!S.history.length;renderSteps();}
function go(id){if(!id||id===S.screen)return;S.history.push(S.screen);show(id,"push");}
function back(){const p=S.history.pop();if(p)show(p,"back");}
function renderSteps(){const sc=SCEN[S.scenario];
$("seg").innerHTML=SCEN.length>1?SCEN.map((s,i)=>'<button data-scen="'+i+'" aria-pressed="'+(i===S.scenario)+'">'+s.name.replace(/</g,"&lt;")+'</button>').join(""):"";
$("steps").innerHTML=sc.steps.map((id,i)=>'<li><button data-jump="'+id+'"'+(id===S.screen?' aria-current="step"':'')+'><span class="no">'+(i+1)+'</span><span>'+((MEMO[id]||{}).title||id).replace(/</g,"&lt;")+'</span></button></li>').join("");
$("jump").innerHTML=sc.steps.map(id=>'<option value="'+id+'"'+(id===S.screen?' selected':'')+'>'+((MEMO[id]||{}).title||id).replace(/</g,"&lt;")+'</option>').join("");}
$("jump").addEventListener("change",e=>go(e.target.value));
document.addEventListener("submit",e=>e.preventDefault());
document.addEventListener("click",e=>{const t=e.target;
const sc=t.closest("[data-scen]");if(sc){S.scenario=+sc.dataset.scen;S.history=[];show(SCEN[S.scenario].steps[0],"push");return;}
const j=t.closest("[data-jump]");if(j){go(j.dataset.jump);return;}
if(t.closest("#back")){back();return;}
if(!t.closest("#viewport"))return;
const g=t.closest("[data-go]"),a=t.closest("a[href]");const raw=g?g.dataset.go:a?a.getAttribute("href"):null;
if(raw===null)return;e.preventDefault();const id=find(raw);if(id)go(id);else toast("移り先「"+raw+"」の画面がありません");});
show(S.screen);
</script></body></html>`;
}
