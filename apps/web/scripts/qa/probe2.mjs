// Verificación de fixes: topbar móvil (hamburger 44, búsqueda icono→barra), sombra de scroll en tablas, contenedor de la tabla de conversaciones.
import { createRequire } from "node:module"; import path from "node:path"; import fs from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const require = createRequire(path.join(args.pw, "package.json")); const { chromium } = require("playwright");
const BASE = args.base ?? "http://localhost:3100"; const OUT = args.out; fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch(args.exe ? { executablePath: args.exe } : {});
  for (const mode of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: mode }); await ctx.addInitScript((m) => localStorage.setItem("easysell-theme", m), mode);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }); await page.fill("#email", "owner@demo.local"); await page.fill("#password", "Demo1234!Demo1234!"); await page.click("button[type=submit]"); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    await page.goto(`${BASE}/quotes`, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
    const topbar = await page.evaluate(() => {
      const sz = (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
      const header = document.querySelector("header");
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth, headerChildren: [...header.querySelectorAll("button, a, input")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ tag: e.tagName.toLowerCase(), label: (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().slice(0, 30), size: sz(e) })) };
    });
    console.log(`\n[${mode}] topbar @390:`, JSON.stringify(topbar));
    // abrir búsqueda
    const searchBtn = page.locator("header button[aria-label*='uscar'], header button:has(svg.lucide-search)").first();
    let opened = null;
    if (await searchBtn.count()) { await searchBtn.click(); await page.waitForTimeout(500); opened = await page.evaluate(() => { const i = document.querySelector("header input, [role=dialog] input, input[aria-label*='uscar']"); if (!i) return null; const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return { size: `${Math.round(r.width)}x${Math.round(r.height)}`, font: cs.fontSize, focused: document.activeElement === i, where: i.closest("[role=dialog]") ? "dialog" : "header" }; }); await page.screenshot({ path: `${OUT}/search-open__${mode}__390.png` }); await page.keyboard.press("Escape"); }
    console.log(`[${mode}] búsqueda abierta:`, JSON.stringify(opened));
    // sombra de scroll
    const shadow = await page.evaluate(() => { const el = document.querySelector(".scroll-x-shadow"); if (!el) return null; const cs = getComputedStyle(el); const after = getComputedStyle(el, "::after"); const before = getComputedStyle(el, "::before"); return { bgImage: cs.backgroundImage.slice(0, 120), mask: (cs.maskImage || cs.webkitMaskImage || "").slice(0, 80), boxShadow: cs.boxShadow.slice(0, 80), after: after.content !== "none" ? { bg: after.backgroundImage.slice(0, 80), w: after.width, pos: after.position } : null, before: before.content !== "none" ? before.backgroundImage.slice(0, 60) : null, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; });
    console.log(`[${mode}] .scroll-x-shadow:`, JSON.stringify(shadow));
    const tbl = page.locator(".scroll-x-shadow").first(); if (await tbl.count()) { const b = await tbl.boundingBox(); await page.screenshot({ path: `${OUT}/table-shadow__${mode}__390.png`, clip: { x: 0, y: Math.max(0, b.y - 10), width: 390, height: Math.min(300, b.height + 20) } }); }
    // conversaciones: cadena de contenedores de la tabla
    await page.goto(`${BASE}/conversations`, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
    const conv = await page.evaluate(() => { const t = document.querySelector("main table"); if (!t) return { noTable: true, scrollWidth: document.documentElement.scrollWidth }; const chain = []; let n = t.parentElement; while (n && n !== document.body && chain.length < 6) { const cs = getComputedStyle(n); chain.push({ tag: n.tagName.toLowerCase(), cls: (n.className || "").toString().split(/\s+/).slice(0, 5).join("."), overflowX: cs.overflowX, w: Math.round(n.getBoundingClientRect().width) }); n = n.parentElement; } const controls = [...document.querySelectorAll("main button, main input, main select, main a[href]")].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().top < 900).map((e) => { const r = e.getBoundingClientRect(); return { l: (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().slice(0, 22), s: `${Math.round(r.width)}x${Math.round(r.height)}`, f: getComputedStyle(e).fontSize }; }).filter((x) => parseInt(x.s.split("x")[1]) < 44 || parseInt(x.s.split("x")[0]) < 44); return { scrollWidth: document.documentElement.scrollWidth, tableWidth: Math.round(t.getBoundingClientRect().width), chain, smallControls: controls.slice(0, 12) }; });
    console.log(`[${mode}] conversations @390:`, JSON.stringify(conv));
    await page.screenshot({ path: `${OUT}/conversations__${mode}__390.png`, fullPage: false });
    // admin @390 controles
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
    const adm = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, small: [...document.querySelectorAll("main button, main input:not([type=hidden]), main select, main a[href]")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { l: (e.getAttribute("aria-label") || e.textContent || e.id || "").trim().slice(0, 22), s: `${Math.round(r.width)}x${Math.round(r.height)}`, type: e.type }; }).filter((x) => parseInt(x.s.split("x")[1]) < 44 || parseInt(x.s.split("x")[0]) < 44).slice(0, 12) }));
    console.log(`[${mode}] admin @390:`, JSON.stringify(adm));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
