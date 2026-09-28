// QA visual + a11y (WCAG 2.2 AA) sobre la web en dev. Uso:
//   node scripts/qa/audit.mjs --base http://localhost:3100 --out <dir> --pw <dir con node_modules/playwright>
// Genera capturas ruta__modo__ancho.png y results.json con: contraste real, tacto, scroll-x, menta, tipografía, foco, consola.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const BASE = args.base ?? "http://localhost:3100";
const OUT = args.out ?? path.resolve("qa-out");
const PW_DIR = args.pw ?? process.cwd();
const MODES = (args.modes ?? "light,dark").split(",");
const ONLY = args.only ? args.only.split(",") : null;
const require = createRequire(path.join(PW_DIR, "package.json"));
const { chromium } = require("playwright");
const EXE = args.exe;

const QUOTE_ID = args.quote ?? "ac88f6b7-84ca-4d3a-b5ff-89c413b1e174";
const QUOTE_TOKEN = args.quoteToken ?? "Mqm4UaJZl2TlhXGX3mswWNGTQ8WRVrtX";
const CHECKOUT_TOKEN = args.checkoutToken ?? "ok5PLZhOUcFkLov9b26AU0RdI8GNOoqc";

const ROUTES = [
  ["/login", false], ["/recover", false],
  ["/dashboard", true], ["/super-admin", true], ["/quotes", true], [`/quotes/${QUOTE_ID}`, true], ["/quick-charge", true],
  ["/orders", true], ["/catalog", true], ["/customers", true], ["/conversations", true], ["/channels", true],
  ["/payments", true], ["/admin", true], ["/ayuda", true],
  [`/quotes/public/${QUOTE_TOKEN}`, false], [`/checkout/${CHECKOUT_TOKEN}`, false],
  // /agent al final: si el servicio del agente no corre, el proxy devuelve 401 y el cliente tira la sesión.
  ["/agent", true],
];
const VIEWPORTS = [[360, 740], [390, 844], [768, 1024], [1280, 800]];

fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

// ---------- código que corre dentro de la página ----------
const inPageAudit = ({ isMobile }) => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const rootBg = (() => {
    const b = parse(getComputedStyle(document.body).backgroundColor);
    const h = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (b && b.a === 1) return b;
    if (h && h.a === 1) return b && b.a > 0 ? over(b, h) : h;
    return over(b ?? { r: 255, g: 255, b: 255, a: 0 }, { r: 255, g: 255, b: 255, a: 1 });
  })();
  // Fondo efectivo: sube por ancestros componiendo capas semitransparentes; detecta gradientes/imágenes.
  const effectiveBg = (el) => {
    const layers = [];
    let node = el, gradient = null, opacity = 1;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const o = parseFloat(cs.opacity); if (!isNaN(o)) opacity *= o;
      const bi = cs.backgroundImage;
      const c = parse(cs.backgroundColor);
      if (bi && bi !== "none" && !gradient) gradient = bi.slice(0, 60);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      node = node.parentElement;
    }
    let bg = rootBg;
    if (!layers.length || layers[layers.length - 1].a < 1) { /* compone sobre canvas */ }
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg, gradient, opacity };
  };
  const shortSel = (el) => {
    const t = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter((c) => c && !/^(text-|bg-|hover:|focus|data-|group|flex|items|justify|gap|w-|h-|p[xy]?-|m[xytb]?-|rounded|border-|shadow)/.test(c)).slice(0, 3).join(".");
    const ds = el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : "";
    return `${t}${id}${ds}${cls ? "." + cls : ""}`;
  };
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom < 0 || r.right < 0) return false;
    return true;
  };
  const inSkeleton = (el) => !!el.closest('.animate-pulse,[data-slot="skeleton"],[aria-busy="true"]');
  const isSrOnly = (el) => { const cs = getComputedStyle(el); return cs.clipPath === "inset(50%)" || (cs.position === "absolute" && cs.width === "1px" && cs.height === "1px") || cs.clip === "rect(0px, 0px, 0px, 0px)"; };

  // ---- 2. contraste ----
  const contrast = []; const gradientText = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const txt = n.textContent.replace(/\s+/g, " ").trim();
    if (!txt) continue;
    const el = n.parentElement; if (!el) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    if (!isVisible(el) || inSkeleton(el) || isSrOnly(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.fontSize === "0px") continue;
    if (cs.webkitTextFillColor && cs.webkitTextFillColor === "rgba(0, 0, 0, 0)") { gradientText.push({ sel: shortSel(el), text: txt.slice(0, 50), reason: "text-fill transparent (gradient text)" }); continue; }
    const fg0 = parse(cs.color); if (!fg0) continue;
    const { bg, gradient, opacity } = effectiveBg(el);
    if (opacity < 0.05) continue;
    const fgA = { ...fg0, a: fg0.a * opacity };
    const fg = fgA.a < 1 ? over(fgA, bg) : fgA;
    const size = parseFloat(cs.fontSize); const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    const key = `${shortSel(el)}|${hex(fg)}|${hex(bg)}`;
    if (gradient) { if (r < need && !seen.has("g" + key)) { seen.add("g" + key); gradientText.push({ sel: shortSel(el), text: txt.slice(0, 50), fg: hex(fg), bgApprox: hex(bg), ratioApprox: +r.toFixed(2), gradient }); } continue; }
    if (r < need && !seen.has(key)) {
      seen.add(key);
      const rect = el.getBoundingClientRect();
      contrast.push({ sel: shortSel(el), text: txt.slice(0, 60), fg: hex(fg), bg: hex(bg), ratio: +r.toFixed(2), need, size: +size.toFixed(1), weight, disabled: !!(el.closest("[disabled],[aria-disabled=true]")), placeholder: false, y: Math.round(rect.top + scrollY) });
    }
  }
  // placeholders de inputs
  for (const inp of document.querySelectorAll("input,textarea")) {
    if (!inp.placeholder || inp.value || !isVisible(inp)) continue;
    const cs = getComputedStyle(inp, "::placeholder");
    const fg0 = parse(cs.color); if (!fg0) continue;
    const { bg } = effectiveBg(inp);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
    const r = ratio(fg, bg);
    if (r < 4.5) contrast.push({ sel: shortSel(inp), text: `[placeholder] ${inp.placeholder.slice(0, 40)}`, fg: hex(fg), bg: hex(bg), ratio: +r.toFixed(2), need: 4.5, size: parseFloat(cs.fontSize), weight: 400, disabled: inp.disabled, placeholder: true });
  }

  // ---- 3. controles: borde de inputs y anillo de foco ----
  const controls = [];
  const measureControl = (el, kind) => {
    const cs = getComputedStyle(el);
    const { bg: outerBg } = effectiveBg(el.parentElement || el);
    const own = parse(cs.backgroundColor);
    const innerBg = own && own.a > 0 ? over(own, outerBg) : outerBg;
    const border = parse(cs.borderTopColor);
    const bw = parseFloat(cs.borderTopWidth);
    const borderRatio = border && border.a > 0 && bw > 0 ? ratio(over(border, outerBg), outerBg) : null;
    el.focus({ preventScroll: true });
    const fcs = getComputedStyle(el);
    const oc = parse(fcs.outlineColor); const ow = parseFloat(fcs.outlineWidth);
    const outlineRatio = oc && ow > 0 && fcs.outlineStyle !== "none" ? ratio(over(oc, outerBg), outerBg) : null;
    const shadow = fcs.boxShadow !== "none" ? fcs.boxShadow : null;
    let shadowRatio = null, shadowColor = null;
    if (shadow) { const c = parse(shadow); if (c && c.a > 0) { shadowColor = hex(over(c, outerBg)); shadowRatio = ratio(over(c, outerBg), outerBg); } }
    const fBorder = parse(fcs.borderTopColor);
    const focusBorderRatio = fBorder && fBorder.a > 0 ? ratio(over(fBorder, outerBg), outerBg) : null;
    const r = el.getBoundingClientRect();
    controls.push({ kind, sel: shortSel(el), size: `${Math.round(r.width)}x${Math.round(r.height)}`, bg: hex(innerBg), outerBg: hex(outerBg), border: border ? hex(over(border, outerBg)) : null, borderWidth: bw, borderRatio: borderRatio && +borderRatio.toFixed(2), outline: oc ? hex(over(oc, outerBg)) : null, outlineWidth: ow, outlineStyle: fcs.outlineStyle, outlineOffset: fcs.outlineOffset, outlineRatio: outlineRatio && +outlineRatio.toFixed(2), shadow: shadow ? shadow.slice(0, 80) : null, shadowColor, shadowRatio: shadowRatio && +shadowRatio.toFixed(2), focusBorder: fBorder ? hex(over(fBorder, outerBg)) : null, focusBorderRatio: focusBorderRatio && +focusBorderRatio.toFixed(2), fontSize: parseFloat(cs.fontSize), radius: cs.borderTopLeftRadius });
    el.blur();
  };
  const firstInput = [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select")].find((e) => isVisible(e) && !e.disabled);
  if (firstInput) measureControl(firstInput, "input");
  const buttons = [...document.querySelectorAll("button,[role=button],a[data-slot=button]")].filter((e) => isVisible(e) && !e.disabled);
  const primary = buttons.find((b) => { const c = parse(getComputedStyle(b).backgroundColor); return c && c.a > 0.5; }) || buttons[0];
  if (primary) measureControl(primary, "button");
  const secondary = buttons.find((b) => b !== primary && /outline|secondary|ghost/.test(b.className)) ;
  if (secondary) measureControl(secondary, "button-secondary");
  const firstLink = [...document.querySelectorAll("a[href]")].find((e) => isVisible(e) && !e.closest("p"));
  if (firstLink) measureControl(firstLink, "link");

  // ---- 4. tacto ----
  const touch = [];
  if (isMobile) {
    const els = document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[tabindex='0'],label[for]");
    const tseen = new Set();
    for (const el of els) {
      if (!isVisible(el) || isSrOnly(el)) continue;
      if (el.tagName === "A" && el.closest("p,li,td")) continue;
      if (el.closest("[aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      if (r.top > innerHeight * 3) continue; // fuera de las primeras 3 pantallas
      if (r.width < 44 || r.height < 44) {
        const k = shortSel(el) + "|" + Math.round(r.width) + "x" + Math.round(r.height);
        if (tseen.has(k)) continue; tseen.add(k);
        // ¿tiene un padre interactivo más grande (p. ej. label de checkbox)?
        const txt = (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 40);
        touch.push({ sel: shortSel(el), size: `${Math.round(r.width)}x${Math.round(r.height)}`, text: txt, inline: el.tagName === "A" && getComputedStyle(el).display === "inline" });
      }
    }
  }

  // ---- 5. scroll horizontal ----
  const scrollX = { scrollWidth: document.documentElement.scrollWidth, innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
  const culprits = [];
  if (scrollX.overflow) {
    for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") { culprits.push({ sel: shortSel(el), right: Math.round(r.right), w: Math.round(r.width) }); if (culprits.length >= 5) break; } }
  }
  scrollX.culprits = culprits;

  // ---- 6. menta ----
  const isMint = (c) => c && c.a > 0.5 && Math.abs(c.r - 0) < 40 && Math.abs(c.g - 212) < 40 && Math.abs(c.b - 164) < 40;
  const isMintText = (c) => c && (isMint(c) || (Math.abs(c.r - 47) < 30 && Math.abs(c.g - 224) < 30 && Math.abs(c.b - 180) < 30));
  const mint = { buttons: [], bodyText: [], otherSurfaces: [] };
  for (const b of document.querySelectorAll("button,a,[role=button]")) {
    if (!isVisible(b)) continue;
    const c = parse(getComputedStyle(b).backgroundColor);
    if (isMint(c)) mint.buttons.push({ sel: shortSel(b), text: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 40) });
  }
  for (const el of document.querySelectorAll("p,span,div,li,td,h1,h2,h3,h4,label,a")) {
    if (!isVisible(el)) continue;
    const direct = [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("").trim();
    if (direct.length < 25) continue;
    const c = parse(getComputedStyle(el).color);
    if (isMintText(c)) mint.bodyText.push({ sel: shortSel(el), text: direct.slice(0, 50), color: hex(c) });
  }
  for (const el of document.querySelectorAll("div,section,header,aside")) {
    if (!isVisible(el)) continue; const r = el.getBoundingClientRect(); if (r.width * r.height < 20000) continue;
    const c = parse(getComputedStyle(el).backgroundColor); if (isMint(c)) mint.otherSurfaces.push({ sel: shortSel(el), size: `${Math.round(r.width)}x${Math.round(r.height)}` });
  }

  // ---- 7. tipografía ----
  const bodyCs = getComputedStyle(document.body);
  const typo = { bodyFontSize: parseFloat(bodyCs.fontSize), bodyFontFamily: bodyCs.fontFamily.slice(0, 60), paragraphs: { total: 0, small: [], tightLH: [] }, smallInputs: [], nonMonoIds: [], monoOk: 0 };
  for (const p of document.querySelectorAll("p")) {
    if (!isVisible(p) || !p.textContent.trim()) continue;
    typo.paragraphs.total++;
    const cs = getComputedStyle(p); const fs = parseFloat(cs.fontSize); const lh = cs.lineHeight === "normal" ? 1.2 * fs : parseFloat(cs.lineHeight);
    if (fs < 16 && p.textContent.trim().length > 60) typo.paragraphs.small.push({ sel: shortSel(p), fs, text: p.textContent.trim().slice(0, 40) });
    if (lh / fs < 1.49) typo.paragraphs.tightLH.push({ sel: shortSel(p), fs, lh: +(lh / fs).toFixed(2), text: p.textContent.trim().slice(0, 40) });
  }
  typo.paragraphs.small = typo.paragraphs.small.slice(0, 8); typo.paragraphs.tightLH = typo.paragraphs.tightLH.slice(0, 8);
  if (isMobile) for (const i of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select")) { if (!isVisible(i)) continue; const fs = parseFloat(getComputedStyle(i).fontSize); if (fs < 16) typo.smallInputs.push({ sel: shortSel(i), fs }); }
  const idRe = /^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{8}\b|^[A-Za-z0-9_-]{24,}$|^#?[A-Z0-9]{6,}$/;
  for (const el of document.querySelectorAll("code,kbd,[data-slot=entity-id],span,td,dd")) {
    if (!isVisible(el)) continue;
    const t = el.textContent.trim();
    const isCode = el.tagName === "CODE" || el.tagName === "KBD" || el.hasAttribute("data-slot") && el.getAttribute("data-slot") === "entity-id" || (idRe.test(t) && t.length <= 40 && !/\s/.test(t) && el.children.length === 0);
    if (!isCode) continue;
    const ff = getComputedStyle(el).fontFamily;
    if (/Geist Mono|ui-monospace|monospace|Menlo|SF Mono/i.test(ff)) typo.monoOk++; else typo.nonMonoIds.push({ sel: shortSel(el), text: t.slice(0, 30), ff: ff.slice(0, 40) });
  }
  typo.nonMonoIds = typo.nonMonoIds.slice(0, 8);

  // ---- 8. radios / forma (muestras) ----
  const radii = { buttons: {}, inputs: {}, cards: {} };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const b of document.querySelectorAll("button,a[data-slot=button]")) if (isVisible(b) && b.getBoundingClientRect().height >= 28) bump(radii.buttons, getComputedStyle(b).borderTopLeftRadius);
  for (const i of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select")) if (isVisible(i)) bump(radii.inputs, getComputedStyle(i).borderTopLeftRadius);
  for (const c of document.querySelectorAll("[data-slot=card],[class*=card],article,section > div[class*=border]")) if (isVisible(c) && c.getBoundingClientRect().width > 200) bump(radii.cards, getComputedStyle(c).borderTopLeftRadius + "|" + (parse(getComputedStyle(c).borderTopColor)?.a > 0 && parseFloat(getComputedStyle(c).borderTopWidth) > 0 ? "border" : "noborder"));

  const htmlClass = document.documentElement.className;
  return { htmlClass, title: document.title, url: location.pathname, contrast, gradientText, controls, touch, scrollX, mint, typo, radii, textNodes: seen.size };
};

// Medición de foco real por teclado (Tab) y de hover: corre en el navegador.
const focusedInfo = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const effBg = (el) => { let node = el; const layers = []; while (node && node !== document.documentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } node = node.parentElement; } let bg = parse(getComputedStyle(document.body).backgroundColor); if (!bg || bg.a < 1) bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); return bg; };
  const el = document.activeElement; if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const outerBg = effBg(el.parentElement || el);
  const outline = parse(cs.outlineColor); const ow = parseFloat(cs.outlineWidth);
  const shadows = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/\),\s*/).map((x) => (x.endsWith(")") ? x : x + ")"));
  const rings = shadows.map((sh) => { const c = parse(sh); const nums = sh.replace(/rgba?\([^)]+\)/, "").trim().split(/\s+/).map(parseFloat); return c && c.a > 0 ? { color: hex(over(c, outerBg)), spread: nums[3] || 0, ratioVsBg: +ratio(over(c, outerBg), outerBg).toFixed(2) } : null; }).filter(Boolean);
  const ringMain = rings.filter((r) => r.ratioVsBg > 1.2).sort((a, b) => b.spread - a.spread)[0] || null;
  const tag = el.tagName.toLowerCase(); const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).slice(0, 3).join(".");
  const fg = parse(cs.color); const ownBg = parse(cs.backgroundColor); const bgNow = ownBg && ownBg.a > 0 ? over(ownBg, outerBg) : outerBg;
  return { sel: `${tag}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`, text: (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 40), outline: outline && ow > 0 && cs.outlineStyle !== "none" ? { color: hex(over(outline, outerBg)), width: ow, offset: cs.outlineOffset, ratioVsBg: +ratio(over(outline, outerBg), outerBg).toFixed(2) } : null, ring: ringMain, ringsAll: rings.slice(0, 3), border: { color: hex(over(parse(cs.borderTopColor) || { r: 0, g: 0, b: 0, a: 0 }, outerBg)), width: parseFloat(cs.borderTopWidth), ratioVsBg: +ratio(over(parse(cs.borderTopColor) || { r: 0, g: 0, b: 0, a: 0 }, outerBg), outerBg).toFixed(2) }, textRatio: fg ? +ratio(over(fg, bgNow), bgNow).toFixed(2) : null, outerBg: hex(outerBg) };
};
const hoverInfo = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const el = [...document.querySelectorAll(":hover")].pop(); if (!el) return null;
  let node = el; const layers = []; while (node && node !== document.documentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } node = node.parentElement; }
  let bg = { r: 255, g: 255, b: 255, a: 1 }; const bb = parse(getComputedStyle(document.body).backgroundColor); if (bb && bb.a === 1) bg = bb; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
  const textEl = el.querySelector("span,p") || el; const fg = parse(getComputedStyle(textEl).color);
  return { sel: el.tagName.toLowerCase() + "." + (typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : ""), text: (el.textContent || "").trim().slice(0, 30), bg: hex(bg), fg: fg ? hex(over(fg, bg)) : null, ratio: fg ? +ratio(over(fg, bg), bg).toFixed(2) : null };
};

// ---------- runner ----------
async function run() {
  const results = [];
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: mode === "dark" ? "dark" : "light", locale: "es-MX" });
    await ctx.addInitScript((m) => { try { localStorage.setItem("easysell-theme", m); } catch {} }, mode);
    const page = await ctx.newPage();
    const consoleLog = [];
    page.on("console", (msg) => { if (["error", "warning"].includes(msg.type())) consoleLog.push({ type: msg.type(), text: msg.text().slice(0, 300), url: page.url() }); });
    page.on("pageerror", (err) => consoleLog.push({ type: "pageerror", text: String(err.message).slice(0, 300), url: page.url() }));
    // login (se repite si alguna ruta tiró la sesión)
    const login = async () => {
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await page.fill("#email", "owner@demo.local");
      await page.fill("#password", "Demo1234!Demo1234!");
      await page.click("button[type=submit]");
      try { await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }); } catch { console.error("[login] no redirigió; url=", page.url()); }
      console.error(`[${mode}] login ok=${!page.url().includes("/login")} -> ${page.url()}`);
    };
    await login();
    const sessionLost = async () => page.url().includes("/login") || (await page.locator("header a[href='/login'], header a:has-text('Entrar')").count()) > 0;

    for (const [route, needsAuth] of ROUTES) {
      if (ONLY && !ONLY.some((o) => route.startsWith(o))) continue;
      if (needsAuth && (await sessionLost())) { console.error(`[${mode}] sesión perdida antes de ${route}; re-login`); await login(); }
      for (const [w, h] of VIEWPORTS) {
        const consoleStart = consoleLog.length;
        await page.setViewportSize({ width: w, height: h });
        let status = null;
        try {
          const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
          status = resp?.status() ?? null;
        } catch (e) { console.error(`[${mode}] ${route}@${w} goto error: ${e.message.split("\n")[0]}`); }
        // espera a que desaparezcan skeletons
        try { await page.waitForFunction(() => !document.querySelector('.animate-pulse,[data-slot="skeleton"]'), null, { timeout: 8000 }); } catch {}
        await page.waitForTimeout(600);
        const finalUrl = new URL(page.url()).pathname;
        const safe = route.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "") || "root";
        const shot = path.join(OUT, "shots", `${safe}__${mode}__${w}.png`);
        try { await page.screenshot({ path: shot, fullPage: true }); } catch (e) { console.error("shot error", e.message); }
        let audit = null;
        try { audit = await page.evaluate(inPageAudit, { viewportW: w, isMobile: w <= 390 }); } catch (e) { audit = { error: e.message.slice(0, 200) }; }
        // foco real por teclado (solo 1280 y 390) + hover de botón primario / nav
        let keyboardFocus = null, hovers = null;
        if (w === 1280 || w === 390) {
          keyboardFocus = [];
          try {
            await page.mouse.click(2, 2); // resetea foco al body
            for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); const info = await page.evaluate(focusedInfo); if (info) keyboardFocus.push(info); }
          } catch (e) { keyboardFocus = { error: e.message.slice(0, 120) }; }
          hovers = [];
          for (const sel of ["aside a[href], nav a[href]", "button[type=submit], main button, header button"]) {
            try { const loc = page.locator(sel).first(); if (await loc.count()) { await loc.hover({ timeout: 2000 }); await page.waitForTimeout(250); const hv = await page.evaluate(hoverInfo); if (hv) hovers.push(hv); } } catch {}
          }
        }
        results.push({ route, mode, viewport: `${w}x${h}`, status, finalUrl, redirected: finalUrl !== route, shot, console: consoleLog.slice(consoleStart), keyboardFocus, hovers, ...audit });
        const c = audit?.contrast?.length ?? "-", t = audit?.touch?.length ?? "-";
        console.error(`[${mode}] ${route}@${w} status=${status} url=${finalUrl} contrast=${c} touch=${t} scrollX=${audit?.scrollX?.overflow} mintBtns=${audit?.mint?.buttons?.length}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
  console.error("done ->", path.join(OUT, "results.json"));
}
run().catch((e) => { console.error(e); process.exit(1); });
