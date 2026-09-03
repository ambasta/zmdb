// The chrome every page on the docs site shares: the sticky top bar, the sidebar,
// the light/dark theme, and the ⌘K search palette.
//
// Three constraints shaped this file, and they are worth stating because they rule
// out the usual answers:
//
//   * No external service. Search is a static index emitted at build time and
//     ranked in the browser, so the docs work offline, from a file:// path, and
//     without sending anyone's queries to a third party. That rules out Algolia.
//   * No runtime dependency. The theme, the palette and the scrollspy are plain
//     DOM in one inline script; nothing is fetched from a CDN. (ARCHITECTURE.md
//     directive 7 — and a docs site that needs the network to render is a poor
//     advertisement for a framework that does not.)
//   * The theme must be right on the first frame. A toggle that reads
//     localStorage after paint flashes the wrong colours, so the resolution runs
//     in <head>, before the body exists.
//
// The index itself is loaded lazily, on first open, as a <script> rather than a
// fetch() — fetch of a file:// URL is blocked by browsers, a script tag is not.

/** Sets `data-theme` before first paint. Must stay inline in `<head>`. */
export const THEME_BOOT = `(function(){try{var s=localStorage.getItem('zmdb-theme');
document.documentElement.dataset.theme=s||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export const SHELL_CSS = `
:root{
  --bg:#0d1117;--panel:#161b22;--panel-2:#1c2128;--sunken:#0b0f14;--fg:#e6edf3;--fg-soft:#c9d1d9;
  --muted:#8b949e;--accent:#58a6ff;--accent-ink:#0d1117;--ok:#3fb950;--todo:#d29922;--danger:#f85149;
  --line:#30363d;--line-soft:#21262d;--shadow:0 16px 48px rgba(1,4,9,.85);
  --tok-comment:#8b949e;--tok-keyword:#ff7b72;--tok-string:#a5d6ff;--tok-number:#79c0ff;
  --tok-type:#7ee787;--tok-fn:#d2a8ff;--tok-literal:#79c0ff;--tok-decorator:#ffa657;--tok-regex:#7ee787;
  --mark:rgba(210,153,34,.32);
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --topbar:56px;
}
:root[data-theme=light]{
  --bg:#fff;--panel:#f6f8fa;--panel-2:#eef1f4;--sunken:#f6f8fa;--fg:#1f2328;--fg-soft:#32383f;
  --muted:#656d76;--accent:#0969da;--accent-ink:#fff;--ok:#1a7f37;--todo:#9a6700;--danger:#cf222e;
  --line:#d0d7de;--line-soft:#e4e8ed;--shadow:0 16px 48px rgba(31,35,40,.18);
  --tok-comment:#6e7781;--tok-keyword:#cf222e;--tok-string:#0a3069;--tok-number:#0550ae;
  --tok-type:#116329;--tok-fn:#8250df;--tok-literal:#0550ae;--tok-decorator:#953800;--tok-regex:#116329;
  --mark:rgba(154,103,0,.22);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:15.5px/1.7 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* ---- top bar ---------------------------------------------------------- */
.topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:14px;height:var(--topbar);
  padding:0 18px;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line)}
.topbar .brand{display:flex;align-items:baseline;gap:8px;font-weight:800;font-size:18px;letter-spacing:-.02em;color:var(--fg)}
.topbar .brand:hover{text-decoration:none}
.topbar .brand em{font-style:normal;font-size:11.5px;font-weight:500;color:var(--muted);letter-spacing:0}
.topbar .spacer{flex:1}
.topbar .tlink{color:var(--muted);font-size:14px;font-weight:500}
.topbar .tlink:hover,.topbar .tlink.active{color:var(--fg);text-decoration:none}
.iconbtn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;
  background:none;border:1px solid var(--line);border-radius:8px;color:var(--muted);cursor:pointer;font-size:14px;line-height:1}
.iconbtn:hover{color:var(--fg);border-color:var(--accent)}
.burger{display:none}
.searchbtn{display:flex;align-items:center;gap:8px;min-width:210px;padding:6px 10px;background:var(--sunken);
  border:1px solid var(--line);border-radius:8px;color:var(--muted);font:inherit;font-size:13px;cursor:pointer;text-align:left}
.searchbtn:hover{border-color:var(--accent);color:var(--fg)}
.searchbtn .kbd{margin-left:auto}
.kbd{font:11px/1 var(--mono);border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;
  padding:3px 5px;color:var(--muted);background:var(--panel)}

/* ---- layout ----------------------------------------------------------- */
.layout{display:grid;grid-template-columns:288px minmax(0,1fr) 232px;align-items:start}
aside{position:sticky;top:var(--topbar);height:calc(100vh - var(--topbar));overflow-y:auto;
  padding:18px 12px 48px;border-right:1px solid var(--line);background:var(--panel);overscroll-behavior:contain}
aside::-webkit-scrollbar,.toc::-webkit-scrollbar{width:8px}
aside::-webkit-scrollbar-thumb,.toc::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}
main{padding:34px 52px 72px;max-width:880px;min-width:0}
.toc{position:sticky;top:var(--topbar);height:calc(100vh - var(--topbar));overflow-y:auto;padding:34px 18px 48px;
  font-size:13px;border-left:1px solid var(--line)}

/* ---- sidebar nav ------------------------------------------------------ */
.navsearch{width:100%;margin:0 0 10px;padding:7px 10px;background:var(--sunken);border:1px solid var(--line);
  border-radius:8px;color:var(--fg);font:inherit;font-size:13px}
.navsearch:focus{outline:none;border-color:var(--accent)}
.nav-group{margin:2px 0;border-radius:8px}
.nav-title{display:flex;align-items:center;gap:6px;padding:6px 8px;color:var(--muted);font-size:11.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;cursor:pointer;list-style:none;border-radius:8px;user-select:none}
.nav-title::-webkit-details-marker{display:none}
.nav-title:hover{background:var(--line-soft);color:var(--fg)}
.nav-title::before{content:"▸";font-size:10px;transition:transform .14s ease;color:var(--muted)}
.nav-group[open]>.nav-title::before{transform:rotate(90deg)}
.nav-title .count{margin-left:auto;font-size:10.5px;font-weight:500;letter-spacing:0;opacity:.75}
.nav-link{display:flex;align-items:center;gap:7px;padding:5px 10px 5px 22px;border-radius:7px;color:var(--fg-soft);font-size:13.5px}
.nav-link:hover{background:var(--line-soft);color:var(--fg);text-decoration:none}
.nav-link.active{background:var(--accent);color:var(--accent-ink);font-weight:600}
.nav-top{padding-left:10px;font-weight:500}
.dot{width:6px;height:6px;border-radius:50%;flex:none;margin-left:auto}
.dot.todo{background:var(--todo)}
.dot.wontfix{background:var(--muted)}
.nav-group.hidden,.nav-link.hidden{display:none}
.nav-empty{color:var(--muted);font-size:13px;padding:8px}

/* ---- prose ------------------------------------------------------------ */
.crumbs{color:var(--muted);font-size:12.5px;margin-bottom:8px}
h1{margin:0 0 6px;font-size:32px;line-height:1.2;letter-spacing:-.025em}
h2{margin:38px 0 12px;font-size:22px;letter-spacing:-.015em;border-bottom:1px solid var(--line);padding-bottom:7px}
h3{margin:26px 0 8px;font-size:17px}
h4{margin:20px 0 6px;font-size:15px}
h1,h2,h3,h4{scroll-margin-top:calc(var(--topbar) + 14px)}
h2 .anchor,h3 .anchor,h4 .anchor{opacity:0;margin-left:8px;color:var(--muted);font-weight:400;text-decoration:none}
h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
p{margin:12px 0}
strong{color:var(--fg)}
code{background:var(--panel-2);padding:1.5px 6px;border-radius:5px;font:13px/1.5 var(--mono)}
pre{position:relative;background:var(--sunken);border:1px solid var(--line);border-radius:10px;padding:14px 16px;
  overflow-x:auto;margin:16px 0}
pre code{background:none;padding:0;font-size:13px;line-height:1.6}
.tok-comment{color:var(--tok-comment);font-style:italic}
.tok-keyword{color:var(--tok-keyword)}
.tok-string{color:var(--tok-string)}
.tok-number{color:var(--tok-number)}
.tok-type{color:var(--tok-type)}
.tok-fn{color:var(--tok-fn)}
.tok-literal{color:var(--tok-literal)}
.tok-decorator{color:var(--tok-decorator)}
.tok-regex{color:var(--tok-regex)}
.codehead{display:flex;align-items:center;gap:8px;position:absolute;top:6px;right:6px}
.lang-tag{font:10.5px/1 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;opacity:0;transition:opacity .12s}
pre:hover .lang-tag{opacity:.9}
.copy-btn{background:var(--panel);border:1px solid var(--line);color:var(--muted);font-size:11px;padding:3px 8px;
  border-radius:6px;cursor:pointer;opacity:0;transition:opacity .12s}
pre:hover .copy-btn,.copy-btn:focus-visible{opacity:1}
.copy-btn:hover{color:var(--fg);border-color:var(--accent)}
.copy-btn.ok{color:var(--ok);border-color:var(--ok)}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13.5px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:7px 11px;text-align:left;vertical-align:top}
th{background:var(--panel);font-size:12.5px;letter-spacing:.02em}
tbody tr:hover td{background:var(--line-soft)}
ul,ol{margin:12px 0;padding-left:24px}li{margin:5px 0}li>ul,li>ol{margin:5px 0}
blockquote{margin:16px 0;padding:2px 16px;border-left:3px solid var(--line);color:var(--muted)}
hr{border:none;border-top:1px solid var(--line);margin:32px 0}
mark{background:var(--mark);color:inherit;border-radius:3px;padding:0 2px}
.admonition{margin:18px 0;border-radius:10px;padding:12px 16px;border:1px solid var(--line);
  border-left-width:4px;background:var(--panel)}
.admonition .adm-title{font-weight:700;font-size:13px;margin-bottom:4px}
.admonition.note{border-left-color:var(--accent)}
.admonition.tip{border-left-color:var(--ok)}
.admonition.warning,.admonition.important{border-left-color:var(--todo)}
.admonition.danger{border-left-color:var(--danger)}
.admonition p{margin:5px 0}
.badge{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 10px;border-radius:20px;
  vertical-align:middle;margin-left:10px}
.badge.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.badge.todo{background:color-mix(in srgb,var(--todo) 16%,transparent);color:var(--todo)}
.badge.muted{background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--muted)}
.todo-banner{background:color-mix(in srgb,var(--todo) 10%,transparent);border:1px solid var(--todo);
  border-radius:10px;padding:14px 16px;margin:18px 0}
.todo-banner b{color:var(--todo)}
.wontfix-banner{background:color-mix(in srgb,var(--muted) 10%,transparent);border:1px solid var(--line);
  border-radius:10px;padding:14px 16px;margin:18px 0;color:var(--fg-soft)}
.wontfix-banner b{color:var(--fg)}

/* ---- on-this-page ---------------------------------------------------- */
.toc-title{color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:10.5px;font-weight:700;margin-bottom:10px}
.toc a{display:block;color:var(--muted);padding:4px 0 4px 10px;border-left:2px solid var(--line);line-height:1.45}
.toc a:hover{color:var(--fg);text-decoration:none}
.toc a.lvl3{padding-left:22px;font-size:12.5px}
.toc a.active{color:var(--accent);border-left-color:var(--accent);font-weight:600}

/* ---- prev / next ----------------------------------------------------- */
.prevnext{display:flex;justify-content:space-between;gap:14px;margin-top:56px;border-top:1px solid var(--line);padding-top:22px}
.prevnext a{display:block;flex:1;border:1px solid var(--line);border-radius:10px;padding:12px 16px;color:var(--fg)}
.prevnext a:hover{border-color:var(--accent);text-decoration:none}
.prevnext .dir{color:var(--muted);font-size:12px}
.prevnext .nxt{text-align:right}

/* ---- search palette -------------------------------------------------- */
.palette[hidden]{display:none}
.palette{position:fixed;inset:0;z-index:90;display:flex;justify-content:center;align-items:flex-start;
  padding:10vh 16px 16px;background:rgba(1,4,9,.62)}
:root[data-theme=light] .palette{background:rgba(31,35,40,.35)}
.pal-box{width:100%;max-width:620px;max-height:74vh;display:flex;flex-direction:column;background:var(--panel);
  border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.pal-input{width:100%;padding:15px 18px;background:none;border:none;border-bottom:1px solid var(--line);
  color:var(--fg);font:inherit;font-size:16px}
.pal-input:focus{outline:none}
.pal-results{overflow-y:auto;padding:6px}
.pal-hit{display:block;padding:9px 12px;border-radius:8px;color:var(--fg)}
.pal-hit:hover{text-decoration:none}
.pal-hit.sel{background:var(--line-soft)}
.pal-hit .t{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.pal-hit .g{font-size:11px;font-weight:500;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:1px 8px}
.pal-hit .s{font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pal-empty{padding:22px 18px;color:var(--muted);font-size:13.5px;text-align:center}
.pal-foot{display:flex;gap:14px;align-items:center;padding:9px 14px;border-top:1px solid var(--line);
  color:var(--muted);font-size:11.5px;background:var(--sunken)}

/* ---- responsive ------------------------------------------------------ */
@media(max-width:1180px){.layout{grid-template-columns:264px minmax(0,1fr)}.toc{display:none}}
@media(max-width:860px){
  .layout{grid-template-columns:minmax(0,1fr)}
  main{padding:24px 20px 64px}
  .burger{display:inline-flex}
  .searchbtn{min-width:0}.searchbtn .label,.searchbtn .kbd{display:none}
  .topbar .tlink{display:none}
  aside{position:fixed;top:var(--topbar);left:0;width:min(320px,86vw);z-index:35;transform:translateX(-102%);
    transition:transform .18s ease;box-shadow:var(--shadow)}
  body.nav-open aside{transform:none}
  body.nav-open .scrim{position:fixed;inset:var(--topbar) 0 0;z-index:30;background:rgba(1,4,9,.5)}
  h1{font-size:26px}h2{font-size:20px}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

/**
 * The client script every page carries: theme toggle, mobile drawer, sidebar
 * filter, collapsible groups, copy buttons, TOC scrollspy and the ⌘K palette.
 * `base` is the relative path back to the site root, used to load the index and
 * to build result links.
 */
export function shellJs(base) {
  return `(function(){
var d=document,root=d.documentElement,BASE=${JSON.stringify(base)};

// ---- theme -------------------------------------------------------------
var tbtn=d.querySelector('[data-theme-toggle]');
function paint(){var l=root.dataset.theme==='light';if(tbtn){tbtn.textContent=l?'☾':'☀';
  tbtn.setAttribute('aria-label',(l?'Dark':'Light')+' theme');tbtn.title=(l?'Dark':'Light')+' theme';}}
paint();
if(tbtn)tbtn.addEventListener('click',function(){
  root.dataset.theme=root.dataset.theme==='light'?'dark':'light';
  try{localStorage.setItem('zmdb-theme',root.dataset.theme);}catch(e){}
  paint();
});

// ---- mobile drawer -----------------------------------------------------
var burger=d.querySelector('[data-nav-toggle]');
function closeNav(){d.body.classList.remove('nav-open');if(burger)burger.setAttribute('aria-expanded','false');}
if(burger)burger.addEventListener('click',function(){
  var open=d.body.classList.toggle('nav-open');
  burger.setAttribute('aria-expanded',open?'true':'false');
});
d.addEventListener('click',function(e){
  if(e.target.classList&&e.target.classList.contains('scrim'))closeNav();
  // A drawer that stays open behind the page you just navigated to is a bug on
  // every phone, so any nav link closes it.
  if(e.target.closest&&e.target.closest('aside a'))closeNav();
});

// ---- sidebar filter + collapsible groups -------------------------------
var box=d.querySelector('.navsearch');
var groups=[].slice.call(d.querySelectorAll('aside .nav-group'));
// Which groups were open before filtering, so clearing the box restores the
// reader's own layout rather than forcing everything open.
var wasOpen=groups.map(function(g){return g.open;});
if(box)box.addEventListener('input',function(){
  var q=box.value.trim().toLowerCase();
  groups.forEach(function(g,i){
    var any=false;
    [].slice.call(g.querySelectorAll('.nav-link')).forEach(function(a){
      var hit=!q||a.textContent.toLowerCase().indexOf(q)>=0;
      a.classList.toggle('hidden',!hit);if(hit)any=true;
    });
    g.classList.toggle('hidden',!any);
    g.open=q?any:wasOpen[i];
  });
});

// ---- copy buttons ------------------------------------------------------
[].slice.call(d.querySelectorAll('pre')).forEach(function(pre){
  var head=d.createElement('div');head.className='codehead';
  var lang=(pre.className.match(/lang-([\\w-]+)/)||[])[1];
  if(lang&&lang!=='undefined'){var t=d.createElement('span');t.className='lang-tag';t.textContent=lang;head.appendChild(t);}
  var b=d.createElement('button');b.className='copy-btn';b.type='button';b.textContent='Copy';
  b.addEventListener('click',function(){
    var code=pre.querySelector('code');
    var text=(code||pre).innerText;
    var done=function(){b.textContent='Copied';b.classList.add('ok');
      setTimeout(function(){b.textContent='Copy';b.classList.remove('ok');},1200);};
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(done,function(){b.textContent='Press ⌘C';});
    else b.textContent='Press ⌘C';
  });
  head.appendChild(b);pre.appendChild(head);
});

// ---- on-this-page scrollspy -------------------------------------------
var tocLinks=[].slice.call(d.querySelectorAll('.toc a'));
if(tocLinks.length&&'IntersectionObserver' in window){
  var byId={};tocLinks.forEach(function(a){byId[a.getAttribute('href').slice(1)]=a;});
  var seen=[];
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      var id=en.target.id;
      var at=seen.indexOf(id);
      if(en.isIntersecting){if(at<0)seen.push(id);}else if(at>=0)seen.splice(at,1);
    });
    if(!seen.length)return;
    // The topmost visible heading is the one the reader is under.
    var best=null,bestTop=Infinity;
    seen.forEach(function(id){
      var el=d.getElementById(id);if(!el)return;
      var top=el.getBoundingClientRect().top;
      if(top<bestTop){bestTop=top;best=id;}
    });
    tocLinks.forEach(function(a){a.classList.remove('active');});
    if(best&&byId[best])byId[best].classList.add('active');
  },{rootMargin:'-64px 0px -70% 0px'});
  Object.keys(byId).forEach(function(id){var el=d.getElementById(id);if(el)io.observe(el);});
}

// ---- ⌘K search palette ------------------------------------------------
var pal=d.querySelector('.palette'),input=d.querySelector('.pal-input'),
    list=d.querySelector('.pal-results');
var index=null,loading=false,hits=[],sel=0;

function ensureIndex(then){
  if(index){then();return;}
  if(window.__ZMDB_SEARCH__){index=window.__ZMDB_SEARCH__;then();return;}
  if(loading)return;
  loading=true;
  // A <script> rather than fetch(): fetch of a file:// URL is blocked, so the
  // docs would lose search entirely when opened from disk.
  var s=d.createElement('script');
  s.src=BASE+'search-index.js';
  s.onload=function(){index=window.__ZMDB_SEARCH__||[];loading=false;then();};
  s.onerror=function(){index=[];loading=false;then();};
  d.head.appendChild(s);
}

// Serialised from the module's own exports, so the ranking in the browser and the
// ranking the tests check are the same source. See scoreRecord / snippetFor.
var snippet=${snippetFor.toString()};
var score=${scoreRecord.toString()};
var termsOf=${queryTerms.toString()};

function render(){
  if(!index){list.innerHTML='<div class="pal-empty">Loading index…</div>';return;}
  var q=input.value.trim();
  if(!q){list.innerHTML='<div class="pal-empty">Search '+index.length+' documentation pages.</div>';hits=[];return;}
  var terms=termsOf(q);
  hits=index.map(function(r){return{r:r,s:score(r,terms)};})
    .filter(function(h){return h.s>0;})
    .sort(function(a,b){return b.s-a.s||a.r.t.length-b.r.t.length;})
    .slice(0,24);
  if(!hits.length){
    list.innerHTML='<div class="pal-empty">No page matches “'+
      q.replace(/[&<>]/g,'')+'”.<br/>Try a capability name, or browse the sidebar.</div>';
    return;
  }
  sel=0;
  list.innerHTML=hits.map(function(h,i){
    var r=h.r;
    return '<a class="pal-hit'+(i===0?' sel':'')+'" href="'+BASE+'docs/'+r.s+'.html">'+
      '<span class="t">'+r.t+(r.d?' <span class="g">'+(r.d===2?'NOT PLANNED':'TODO')+'</span>':'')+'<span class="g">'+r.g+'</span></span>'+
      '<span class="s">'+snippet(r.x,terms)+'</span></a>';
  }).join('');
}

function move(step){
  if(!hits.length)return;
  var nodes=list.querySelectorAll('.pal-hit');
  nodes[sel].classList.remove('sel');
  sel=(sel+step+hits.length)%hits.length;
  nodes[sel].classList.add('sel');
  nodes[sel].scrollIntoView({block:'nearest'});
}

var opener=null;
function openPal(){
  if(!pal)return;
  opener=d.activeElement;
  pal.hidden=false;
  input.value='';
  list.innerHTML='<div class="pal-empty">Loading index…</div>';
  input.focus();
  ensureIndex(render);
}
function closePal(){
  if(!pal)return;
  pal.hidden=true;
  // Hand focus back to whatever opened the dialog. Two things break without this:
  // a keyboard user who escapes out loses their place in the page, and the input
  // it left focused keeps counting as "typing", which swallows the "/" shortcut.
  if(opener&&opener.focus)opener.focus();else if(input.blur)input.blur();
  opener=null;
}

if(pal){
  [].slice.call(d.querySelectorAll('[data-search-open]')).forEach(function(b){
    b.addEventListener('click',openPal);
  });
  input.addEventListener('input',render);
  pal.addEventListener('click',function(e){if(e.target===pal)closePal();});
  input.addEventListener('keydown',function(e){
    if(e.key==='ArrowDown'){e.preventDefault();move(1);}
    else if(e.key==='ArrowUp'){e.preventDefault();move(-1);}
    else if(e.key==='Enter'){
      var node=list.querySelectorAll('.pal-hit')[sel];
      if(node){e.preventDefault();location.href=node.getAttribute('href');}
    }
    // aria-modal says focus must not leave the dialog, and results are chosen with
    // the arrows, so Tab holds the caret in the box instead of walking off into the
    // page behind it. Escape is the way out, and the footer says so.
    else if(e.key==='Tab')e.preventDefault();
  });
}

d.addEventListener('keydown',function(e){
  var typing=/^(INPUT|TEXTAREA|SELECT)$/.test(d.activeElement&&d.activeElement.tagName);
  if((e.key==='k'||e.key==='K')&&(e.metaKey||e.ctrlKey)){e.preventDefault();openPal();return;}
  if(e.key==='Escape'){
    if(pal&&!pal.hidden){closePal();return;}
    if(box&&d.activeElement===box){box.value='';box.dispatchEvent(new Event('input'));box.blur();}
    closeNav();
    return;
  }
  if(typing)return;
  // "/" is the search shortcut everyone else's docs use, so it opens the palette
  // here too rather than only focusing the sidebar filter.
  if(e.key==='/'){e.preventDefault();openPal();}
});
})();`;
}

/**
 * Rank one index record against the query's terms. Zero means "no match".
 *
 * Exported, and deliberately self-contained: the client script serialises this
 * function into the page with `toString()`, so the ranking that runs in the
 * browser is the same code the unit tests exercise in Node. Referencing anything
 * outside the function body would break that, which is why the weights are
 * inline.
 */
export function scoreRecord(rec, terms) {
  var title = rec.t.toLowerCase();
  // The slug is its own tier, and it earns one: titles are prose ("Migrating from
  // Drizzle") while slugs are the words people type ("migrate-from-drizzle"), so a
  // query of "migrate drizzle" would otherwise rank that page below every page
  // that merely mentions both words in passing.
  var slug = rec.s.replace(/-/g, ' ');
  var head = rec.h.join(' ').toLowerCase();
  var body = rec.x.toLowerCase();
  var group = rec.g.toLowerCase();

  var tier = function (t) {
    if (title === t) return 140;
    if (title.indexOf(t) === 0) return 90;
    if (title.indexOf(t) >= 0) return 64;
    if (slug.indexOf(t) >= 0) return 50;
    if (head.indexOf(t) >= 0) return 26;
    if (group.indexOf(t) >= 0) return 14;
    if (body.indexOf(t) >= 0) return 8;
    return 0;
  };

  var total = 0;
  for (var i = 0; i < terms.length; i++) {
    var s = tier(terms[i]);
    // One round of English suffix folding, discounted, so that "paginate" finds
    // "Pagination" and "cache" finds "Caching". Nothing shorter than four
    // characters is folded — "uses" must not become "us". The better of the two
    // wins rather than the folded form being a last resort, because a passing
    // mention in the body would otherwise outrank a title that matches the stem.
    var stem = terms[i].replace(/(ing|ed|es|s|e)$/, '');
    if (stem.length >= 4 && stem !== terms[i]) {
      var folded = Math.round(tier(stem) * 0.6);
      if (folded > s) s = folded;
    }
    // Every term has to appear somewhere. Adding a word to a search is how people
    // narrow it, so the terms are ANDed rather than summed.
    if (s === 0) return 0;
    total += s;
  }
  // On a tie, a page that is a stub or a declined feature should not outrank a
  // written one.
  return rec.d ? total - 3 : total;
}

/**
 * Split a query into the terms to match. Filler words are dropped when anything
 * else survives, so a question ("how do I paginate") searches for the word that
 * carries the meaning instead of demanding every page contain "how" and "i".
 *
 * Serialised into the page like the two functions above, and self-contained for
 * the same reason.
 */
export function queryTerms(query) {
  var raw = query.toLowerCase().split(/[^a-z0-9@/._-]+/);
  var words = [];
  for (var i = 0; i < raw.length; i++) if (raw[i]) words.push(raw[i]);
  var filler = {
    a: 1,
    an: 1,
    and: 1,
    can: 1,
    do: 1,
    does: 1,
    for: 1,
    how: 1,
    i: 1,
    in: 1,
    my: 1,
    of: 1,
    the: 1,
    to: 1,
    what: 1,
    with: 1,
  };
  var kept = [];
  for (var j = 0; j < words.length; j++) if (!filler[words[j]]) kept.push(words[j]);
  // A query that is nothing but filler still deserves an answer — `is` and `in`
  // are real API names here.
  return kept.length > 0 ? kept : words;
}

/**
 * A one-line excerpt around the first matching term, HTML-escaped, with the terms
 * wrapped in `<mark>`. Serialised into the page the same way as `scoreRecord`, so
 * it is likewise self-contained.
 */
export function snippetFor(text, terms) {
  var lower = text.toLowerCase();
  var at = -1;
  for (var i = 0; i < terms.length && at < 0; i++) at = lower.indexOf(terms[i]);
  if (at < 0) at = 0;
  var from = at > 58 ? at - 58 : 0;
  // Escape before inserting <mark>, so a page whose text contains angle brackets
  // cannot inject markup into the result list.
  var out = text
    .slice(from, from + 150)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  for (var j = 0; j < terms.length; j++) {
    if (!terms[j]) continue;
    var safe = terms[j].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('(' + safe + ')', 'ig'), '<mark>$1</mark>');
  }
  return (from > 0 ? '…' : '') + out + '…';
}

/** The palette markup. One per page; hidden until opened. */
export const PALETTE_HTML = `<div class="palette" hidden role="dialog" aria-modal="true" aria-label="Search documentation">
  <div class="pal-box">
    <input class="pal-input" type="search" placeholder="Search the docs…" aria-label="Search documentation" autocomplete="off" spellcheck="false"/>
    <div class="pal-results"></div>
    <div class="pal-foot"><span class="kbd">↑↓</span> navigate <span class="kbd">⏎</span> open <span class="kbd">esc</span> close</div>
  </div>
</div>`;

/**
 * The sticky top bar. `base` is the relative path to the site root; `active`
 * names the current section so its link can be marked.
 */
export function topbarHtml({ base, active = null, withNavToggle = false }) {
  const link = (href, label, key) =>
    `<a class="tlink${active === key ? ' active' : ''}" href="${base}${href}">${label}</a>`;
  return `<header class="topbar">
${withNavToggle ? '<button class="iconbtn burger" type="button" data-nav-toggle aria-expanded="false" aria-label="Toggle navigation">☰</button>' : ''}
<a class="brand" href="${base}index.html">zmdb<em>zero-maintenance data layer</em></a>
<button class="searchbtn" type="button" data-search-open aria-label="Search documentation">
  <span aria-hidden="true">⌕</span><span class="label">Search docs…</span><span class="kbd">⌘K</span>
</button>
<div class="spacer"></div>
${link('docs/introduction.html', 'Docs', 'docs')}
${link('benchmarks/index.html', 'Benchmarks', 'benchmarks')}
${link('docs/anti-patterns.html', 'Anti-patterns', 'anti-patterns')}
<a class="tlink" href="${base}openapi.json" target="_blank" download="openapi.json">OpenAPI</a>
<button class="iconbtn" type="button" data-theme-toggle aria-label="Toggle theme"></button>
<a class="iconbtn" href="https://github.com/ambasta/zmdb" aria-label="GitHub repository">↗</a>
</header>`;
}

// Markdown noise that carries no search signal. Stripped so a query matches the
// words a reader would actually type, and so the index is not padded with syntax.
function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*$/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*(\[!\w+\])?/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The static search index, as a script that assigns to `window.__ZMDB_SEARCH__`.
 *
 * Field names are one character because this file is downloaded whole: over 274
 * pages the difference between `title` and `t` is not rounding. Body text is
 * capped per page — enough for a term to be found and a snippet shown, without
 * shipping the entire corpus twice (it is already on the pages themselves).
 */
export function searchIndexScript(pages, nav) {
  const groupOf = new Map();
  for (const group of nav) {
    for (const slug of group.pages) groupOf.set(slug, group.title);
  }
  const records = Object.entries(pages).map(([slug, page]) => ({
    s: slug,
    t: page.title,
    g: page.group ?? groupOf.get(slug) ?? 'Docs',
    // Headings are the strongest signal after the title: they are what the page
    // promises to cover.
    h: [...page.md.matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => m[1].replace(/[`*]/g, '')),
    x: plainText(page.md).slice(0, 3000),
    // 1 = on the roadmap, 2 = declined. Both are searchable and both rank below a
    // written page; only the label on the row differs.
    ...(page.status === 'todo' ? { d: 1 } : page.status === 'wontfix' ? { d: 2 } : {}),
  }));
  return `window.__ZMDB_SEARCH__=${JSON.stringify(records)};\n`;
}
