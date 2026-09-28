// Estados extra: toast de error (sonner), drawer de navegación móvil, menú de usuario, hover de sidebar.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const require = createRequire(path.join(args.pw, "package.json"));
const { chromium } = require("playwright");
const BASE = args.base ?? "http://localhost:3100"; const OUT = args.out; fs.mkdirSync(OUT, { recursive: true });

const measure = (sel) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const effBg = (el) => { let node = el; const layers = []; while (node && node !== document.documentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } node = node.parentElement; } let bg = parse(getComputedStyle(document.body).backgroundColor); if (!bg || bg.a < 1) bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); return bg; };
  const out = [];
  for (const root of document.querySelectorAll(sel)) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; const seen = new Set();
    while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue; const fg = parse(cs.color); const bg = effBg(el); const r = ratio(over(fg, bg), bg); const k = t.slice(0, 30) + hex(bg); if (seen.has(k)) continue; seen.add(k); out.push({ text: t.slice(0, 40), fg: hex(over(fg, bg)), bg: hex(bg), ratio: +r.toFixed(2), size: parseFloat(cs.fontSize), border: cs.borderTopColor, radius: getComputedStyle(root).borderTopLeftRadius }); }
    const rcs = getComputedStyle(root); const rb = parse(rcs.borderTopColor); const rootBg = effBg(root); const outer = effBg(root.parentElement || document.body);
    out.push({ container: sel, bg: hex(rootBg), outerBg: hex(outer), bgVsOuter: +ratio(rootBg, outer).toFixed(2), border: rb ? hex(over(rb, outer)) : null, borderW: rcs.borderTopWidth, borderRatio: rb && rb.a > 0 ? +ratio(over(rb, outer), outer).toFixed(2) : null, radius: rcs.borderTopLeftRadius, shadow: rcs.boxShadow.slice(0, 60) });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch(args.exe ? { executablePath: args.exe } : {});
  const report = {};
  for (const mode of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: mode });
    await ctx.addInitScript((m) => localStorage.setItem("easysell-theme", m), mode);
    const page = await ctx.newPage(); const rep = (report[mode] = {});
    // 1. login con contraseña mala -> error/toast
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", "owner@demo.local"); await page.fill("#password", "mala-mala-mala"); await page.click("button[type=submit]");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/login-error__${mode}__390.png`, fullPage: true });
    rep.loginError = await page.evaluate(measure, "[role=alert], [data-sonner-toast], [role=status]");
    // login válido
    await page.fill("#password", "Demo1234!Demo1234!"); await page.click("button[type=submit]");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    // 2. toast real: copiar algo / acción que muestre toast -> intentamos en /admin (copiar) o disparamos sonner desde window si expuesto
    await page.goto(`${BASE}/quotes`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    // 3. drawer móvil
    await page.click("button[aria-label='Abrir navegación']"); await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/nav-drawer__${mode}__390.png` });
    rep.drawer = await page.evaluate(measure, "[role=dialog]");
    rep.drawerTouch = await page.evaluate(() => [...document.querySelectorAll("[role=dialog] a[href],[role=dialog] button")].map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h && (x.h < 44 || x.w < 44)));
    rep.drawerActive = await page.evaluate(() => { const a = document.querySelector("[role=dialog] a[aria-current=page]"); if (!a) return null; const cs = getComputedStyle(a); return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, text: a.textContent.trim().slice(0, 20) }; });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    // 4. menú de usuario
    await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(`${BASE}/quotes`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    const um = page.locator("header button").last(); await um.click(); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/user-menu__${mode}__1280.png` });
    rep.userMenu = await page.evaluate(measure, "[role=menu]");
    await page.keyboard.press("Escape");
    // 5. sidebar activo + hover
    rep.sidebarActive = await page.evaluate(() => { const a = document.querySelector("aside a[aria-current=page], nav a[aria-current=page]"); if (!a) return null; const cs = getComputedStyle(a); const dot = a.querySelector("span.bg-brand"); return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height), dot: dot ? getComputedStyle(dot).backgroundColor : null, text: a.textContent.trim().slice(0, 20) }; });
    const inactive = page.locator("nav a[href]:not([aria-current])").first(); await inactive.hover(); await page.waitForTimeout(300);
    rep.sidebarHover = await page.evaluate(() => { const a = [...document.querySelectorAll("nav a:hover")].pop(); if (!a) return null; const cs = getComputedStyle(a); return { bg: cs.backgroundColor, color: cs.color, text: a.textContent.trim().slice(0, 20) }; });
    await page.screenshot({ path: `${OUT}/sidebar-hover__${mode}__1280.png`, clip: { x: 0, y: 0, width: 300, height: 800 } });
    // 6. toast sonner: /admin copiar api key o /quotes acción; intentamos disparar via botón "Copiar"
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    const copyBtn = page.locator("button", { hasText: /copiar/i }).first();
    if (await copyBtn.count()) { await copyBtn.click(); await page.waitForTimeout(700); }
    rep.toast = await page.evaluate(measure, "[data-sonner-toast]");
    await page.screenshot({ path: `${OUT}/toast__${mode}__1280.png`, clip: { x: 780, y: 0, width: 500, height: 200 } });
    // 7. focus-visible real en botón primario del login (Tab)
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }); await page.mouse.click(2, 2);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    await page.screenshot({ path: `${OUT}/login-focus__${mode}__1280.png` });
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/states.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
