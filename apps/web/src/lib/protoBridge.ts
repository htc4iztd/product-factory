// プロトタイプ（1つの HTML。script を含む）を、隔離した枠（sandbox="allow-scripts"・別オリジン）で動かすための差し込み。
// - CSP：外への通信（fetch・送信・外部の script）を止める。フォントは Google Fonts だけ許す
// - 橋渡しの script：コメントのモード（部品を押すと、位置（CSS パス）・見出し・いまの画面を親に送る）と、コメントのピン
//   親とは postMessage だけでやり取りする（親の画面・クッキーには触れられない）

export const PROTO_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src data: blob:; media-src data: blob:; form-action 'none'";

const BRIDGE = `(function(){
if(window.__pfBridge)return;window.__pfBridge=1;
var mode=false,pins=[],active=null,layer=null,queued=false;
var st=document.createElement('style');
st.textContent='[data-pf-hover]{outline:2px dashed #f59e0b!important;outline-offset:-2px}html.pf-commenting,html.pf-commenting *{cursor:crosshair!important}'
+'.pf-pin{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:999px 999px 999px 2px;background:#f59e0b;color:#fff;font:600 11px/22px system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3);cursor:pointer;pointer-events:auto}'
+'.pf-pin.sent{background:#0284c7}.pf-pin.applied{background:#059669}.pf-pin.on{outline:3px solid #4f46e5}';
(document.head||document.documentElement).appendChild(st);
function post(m){m.pf=1;parent.postMessage(m,'*');}
function path(el){var out=[];while(el&&el.nodeType===1&&el.tagName!=='BODY'&&el.tagName!=='HTML'){
 if(el.id&&/^[A-Za-z][\\w-]*$/.test(el.id)){out.unshift('#'+el.id);break;}
 var t=el.tagName.toLowerCase(),p=el.parentElement,same=p?[].filter.call(p.children,function(c){return c.tagName===el.tagName;}):[];
 out.unshift(same.length>1?t+':nth-of-type('+(same.indexOf(el)+1)+')':t);el=p;}
 return out.join(' > ').slice(0,500);}
function label(el){var t=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();var k=el.tagName.toLowerCase();
 return t?k+'「'+t.slice(0,30)+(t.length>30?'…':'')+'」':k;}
function ctx(el){var s=el&&el.closest&&el.closest('[data-screen]');if(s)return s.getAttribute('data-screen-name')||s.getAttribute('data-screen');
 var c=document.querySelector('[aria-current]');return c?(c.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80):'';}
function draw(){queued=false;if(!layer){layer=document.createElement('div');layer.id='pf-pins';
 layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';document.documentElement.appendChild(layer);}
 layer.innerHTML='';pins.forEach(function(p){if(p.status==='resolved')return;var el=null;try{el=document.querySelector(p.target);}catch(e){}
  if(!el||(p.context&&ctx(el)!==p.context))return;var r=el.getBoundingClientRect();if(!r.width&&!r.height)return;
  var d=document.createElement('div');d.className='pf-pin '+p.status+(p.id===active?' on':'');d.textContent=p.n;d.setAttribute('data-pf-pin',p.id);
  d.title=p.text||'';d.style.left=(r.left+Math.min(r.width-6,14))+'px';d.style.top=(r.top+4)+'px';layer.appendChild(d);});}
function later(){if(!queued){queued=true;requestAnimationFrame(draw);}}
function unhover(){[].forEach.call(document.querySelectorAll('[data-pf-hover]'),function(x){x.removeAttribute('data-pf-hover');});}
window.addEventListener('message',function(e){var d=e.data;if(!d||d.pf!==1||e.source!==parent)return;
 if(d.type==='mode'){mode=!!d.on;document.documentElement.classList.toggle('pf-commenting',mode);if(!mode)unhover();}
 if(d.type==='pins'){pins=d.pins||[];active=d.active||null;later();}});
window.addEventListener('mouseover',function(e){if(!mode)return;unhover();var t=e.target;
 if(t&&t.nodeType===1&&t.tagName!=='BODY'&&t.tagName!=='HTML'&&!t.closest('#pf-pins'))t.setAttribute('data-pf-hover','');},true);
function block(e){if(mode){e.preventDefault();e.stopImmediatePropagation();}}
['pointerdown','mousedown','mouseup','touchstart','submit','change','input'].forEach(function(k){window.addEventListener(k,block,true);});
window.addEventListener('click',function(e){var t=e.target;var pin=t&&t.closest&&t.closest('[data-pf-pin]');
 if(pin){e.preventDefault();e.stopImmediatePropagation();post({type:'pin',id:pin.getAttribute('data-pf-pin')});return;}
 if(!mode)return;e.preventDefault();e.stopImmediatePropagation();
 if(!t||t.nodeType!==1||t.tagName==='BODY'||t.tagName==='HTML')return;unhover();var r=t.getBoundingClientRect();
 post({type:'pick',target:path(t),label:label(t),context:ctx(t),rect:{left:r.left,top:r.top,bottom:r.bottom,width:r.width},
  vw:window.innerWidth,vh:window.innerHeight});},true);
window.addEventListener('scroll',later,true);window.addEventListener('resize',later);
var lastW=0;function size(){var w=document.documentElement.scrollWidth,h=document.documentElement.scrollHeight;
 if(Math.abs(w-lastW)>4){lastW=w;post({type:'size',w:w,h:h});}}
window.addEventListener('load',function(){size();setTimeout(size,400);setTimeout(size,1500);});
function watch(){if(!document.body)return setTimeout(watch,50);new MutationObserver(later).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style','aria-current']});later();}
watch();post({type:'ready'});
})();`;

// 表示用の HTML：CSP を head の頭に、橋渡しの script を最後に差し込む（保存する HTML には入れない）
export function withBridge(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PROTO_CSP}">`;
  let out = html;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + meta);
  else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`);
  else if (/^\s*<!doctype[^>]*>/i.test(out)) out = out.replace(/^\s*<!doctype[^>]*>/i, (m) => `${m}<head>${meta}</head>`);
  else out = `<!doctype html><head>${meta}</head>` + out;
  const script = `<script>${BRIDGE}</script>`;
  const i = out.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? out.slice(0, i) + script + out.slice(i) : out + script;
}
