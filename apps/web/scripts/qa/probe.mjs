// Sondas puntuales: texto sobre hero-dark (gradiente), tablas recortadas en móvil, culpables de overflow, borde de tarjetas en claro.
import { createRequire } from "node:module"; import path from "node:path";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const require = createRequire(path.join(args.pw, "package.json")); const { chromium } = require("playwright");
const BASE = args.base ?? "http://localhost:3100";
const helpers = `
const parse=(c)=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
const lum=({r,g,b})=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
const over=(fg,bg)=>({r:fg.r*fg.a+bg.r*(1-fg.a),g:fg.g*fg.a+bg.g*(1-fg.a),b:fg.b*fg.a+bg.b*(1-fg.a),a:1});
const hex=(c)=>"#"+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,"0")).join("");`;
const gradientText = new Function(helpers + `
const out=[];
for(const el of document.querySelectorAll("p,span,h1,h2,h3,time,small")){
  let node=el.parentElement,grad=null,depth=0;
  while(node&&depth<8){const bi=getComputedStyle(node).backgroundImage;if(bi&&bi.startsWith("linear-gradient")){grad=bi;break;}node=node.parentElement;depth++;}
  if(!grad)continue;const t=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join("").trim();if(!t)continue;
  const cs=getComputedStyle(el);const fg=parse(cs.color);if(!fg)continue;let op=1;let n=el;while(n&&n!==document.body){op*=parseFloat(getComputedStyle(n).opacity)||1;n=n.parentElement;}
  const stops=[...grad.matchAll(/rgba?\\([^)]+\\)/g)].map(m=>parse(m[0])).filter(c=>c&&c.a>0);
  const rs=stops.map(s=>ratio(over({...fg,a:fg.a*op},s),s));
  out.push({text:t.slice(0,45),fg:hex(fg),alpha:+(fg.a*op).toFixed(2),size:parseFloat(cs.fontSize),weight:cs.fontWeight,stops:stops.map(hex),minRatio:+Math.min(...rs).toFixed(2),maxRatio:+Math.max(...rs).toFixed(2)});
}
return out;`);
const tableClip = new Function(helpers + `
const out=[];
for(const table of document.querySelectorAll("table")){
  const tr=table.getBoundingClientRect();let n=table.parentElement,clipper=null;
  while(n&&n!==document.body){const cs=getComputedStyle(n);const r=n.getBoundingClientRect();if(/(hidden|clip)/.test(cs.overflowX)&&r.right<tr.right-1){clipper={tag:n.tagName.toLowerCase(),cls:(n.className||"").toString().split(/\\s+/).slice(0,4).join("."),right:Math.round(r.right),overflowX:cs.overflowX};break;}if(/(auto|scroll)/.test(cs.overflowX)){clipper={scrollable:true,tag:n.tagName.toLowerCase(),cls:(n.className||"").toString().split(/\\s+/).slice(0,4).join("."),scrollWidth:n.scrollWidth,clientWidth:n.clientWidth};break;}n=n.parentElement;}
  out.push({tableWidth:Math.round(tr.width),tableRight:Math.round(tr.right),innerWidth,clipper});
}
return out;`);
const overflowCulprits = new Function(helpers + `
const out=[];const seen=new Set();
for(const el of document.querySelectorAll("main *, header *")){const r=el.getBoundingClientRect();if(r.width>0&&r.right>innerWidth+2&&r.width>=innerWidth*0.5){const k=el.tagName+el.className;if(seen.has(k))continue;seen.add(k);out.push({tag:el.tagName.toLowerCase(),cls:(el.className||"").toString().split(/\\s+/).slice(0,6).join("."),w:Math.round(r.width),right:Math.round(r.right),id:el.id||null});}}
return {scrollWidth:document.documentElement.scrollWidth,innerWidth,culprits:out.slice(0,8)};`);
const cardBorder = new Function(helpers + `
const c=document.querySelector("[class*='bg-card'], .rounded-lg.border");if(!c)return null;const cs=getComputedStyle(c);const bb=parse(getComputedStyle(document.body).backgroundColor);const cb=parse(cs.backgroundColor);const bo=parse(cs.borderTopColor);
return {cardBg:hex(over(cb,bb)),bodyBg:hex(bb),bgRatio:+ratio(over(cb,bb),bb).toFixed(2),border:hex(over(bo,bb)),borderVsBody:+ratio(over(bo,bb),bb).toFixed(2),borderVsCard:+ratio(over(bo,bb),over(cb,bb)).toFixed(2),borderWidth:cs.borderTopWidth,radius:cs.borderTopLeftRadius};`);
(async()=>{
  const browser=await chromium.launch(args.exe?{executablePath:args.exe}:{});
  for(const mode of ["light","dark"]){
    const ctx=await browser.newContext({viewport:{width:390,height:844},colorScheme:mode});await ctx.addInitScript((m)=>localStorage.setItem("easysell-theme",m),mode);const page=await ctx.newPage();
    console.log(`\n===== ${mode} =====`);
    await page.goto(`${BASE}/quotes/public/Mqm4UaJZl2TlhXGX3mswWNGTQ8WRVrtX`,{waitUntil:"networkidle"});await page.waitForTimeout(500);
    console.log("hero público (390):",JSON.stringify(await page.evaluate(gradientText)));
    await page.setViewportSize({width:1280,height:800});await page.goto(`${BASE}/login`,{waitUntil:"networkidle"});
    console.log("hero login (1280):",JSON.stringify(await page.evaluate(gradientText)));
    await page.fill("#email","owner@demo.local");await page.fill("#password","Demo1234!Demo1234!");await page.click("button[type=submit]");await page.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:20000});
    await page.goto(`${BASE}/ayuda`,{waitUntil:"networkidle"});await page.waitForTimeout(400);console.log("hero ayuda (1280):",JSON.stringify(await page.evaluate(gradientText)));
    console.log("card border (ayuda 1280):",JSON.stringify(await page.evaluate(cardBorder)));
    await page.setViewportSize({width:390,height:844});
    for(const r of ["/quotes","/orders","/customers","/payments"]){await page.goto(`${BASE}${r}`,{waitUntil:"networkidle"});await page.waitForTimeout(600);console.log(`tabla ${r} @390:`,JSON.stringify(await page.evaluate(tableClip)));}
    for(const r of ["/conversations","/admin"]){await page.goto(`${BASE}${r}`,{waitUntil:"networkidle"});await page.waitForTimeout(600);console.log(`overflow ${r} @390:`,JSON.stringify(await page.evaluate(overflowCulprits)));}
    await page.setViewportSize({width:768,height:1024});await page.goto(`${BASE}/quotes`,{waitUntil:"networkidle"});await page.waitForTimeout(400);console.log("overflow /quotes @768:",JSON.stringify(await page.evaluate(overflowCulprits)));
    await ctx.close();
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
