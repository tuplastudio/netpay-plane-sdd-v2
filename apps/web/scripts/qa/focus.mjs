// Foco real por teclado (Tab) con parser de box-shadow correcto + inventario de botones no-píldora.
import { createRequire } from "node:module"; import path from "node:path"; import fs from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const require = createRequire(path.join(args.pw, "package.json")); const { chromium } = require("playwright");
const BASE = args.base ?? "http://localhost:3100"; const OUT = args.out; fs.mkdirSync(OUT, { recursive: true });
const ROUTES = (args.routes ?? "/login,/super-admin,/quotes,/admin").split(",");
const focusedInfo = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const effBg = (el) => { let node = el; const layers = []; while (node && node !== document.documentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } node = node.parentElement; } let bg = parse(getComputedStyle(document.body).backgroundColor); if (!bg || bg.a < 1) bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); return bg; };
  const el = document.activeElement; if (!el || el === document.body) return null;
  const cs = getComputedStyle(el); const outerBg = effBg(el.parentElement || el);
  const splitShadows = (s) => { const out = []; let depth = 0, cur = ""; for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const shadows = cs.boxShadow === "none" ? [] : splitShadows(cs.boxShadow);
  const rings = shadows.map((sh) => { const c = parse(sh); if (!c || c.a === 0) return null; const nums = sh.replace(/rgba?\([^)]+\)/, "").trim().split(/\s+/).map(parseFloat); return { color: hex(over(c, outerBg)), spread: nums[3] || 0, blur: nums[2] || 0, ratioVsBg: +ratio(over(c, outerBg), outerBg).toFixed(2) }; }).filter(Boolean);
  // El anillo "útil" es el de mayor spread cuyo color contraste con el fondo; el offset (mismo color que el fondo) se ignora.
  const ring = rings.filter((r) => r.spread > 0 && r.ratioVsBg >= 1.2).sort((a, b) => b.spread - a.spread)[0] || null;
  const oc = parse(cs.outlineColor); const ow = parseFloat(cs.outlineWidth);
  const outline = oc && oc.a > 0 && ow > 0 && cs.outlineStyle !== "none" ? { color: hex(over(oc, outerBg)), width: ow, ratioVsBg: +ratio(over(oc, outerBg), outerBg).toFixed(2) } : null;
  const bc = parse(cs.borderTopColor); const bw = parseFloat(cs.borderTopWidth);
  const tag = el.tagName.toLowerCase(); const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).slice(0, 2).join(".");
  const r = el.getBoundingClientRect();
  return { sel: `${tag}${el.id ? "#" + el.id : ""}.${cls}`, text: (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 32), size: `${Math.round(r.width)}x${Math.round(r.height)}`, ring, outline, border: bc && bc.a > 0 && bw > 0 ? { color: hex(over(bc, outerBg)), width: bw, ratioVsBg: +ratio(over(bc, outerBg), outerBg).toFixed(2) } : null, boxShadow: cs.boxShadow.slice(0, 120), outerBg: hex(outerBg) };
};
const nonPill = () => [...document.querySelectorAll("button, a[data-slot=button], [role=button]")].filter((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width > 0 && r.height >= 28 && cs.visibility !== "hidden" && cs.borderTopLeftRadius !== "9999px" && !b.closest("[role=tablist]"); }).map((b) => ({ text: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 30), radius: getComputedStyle(b).borderTopLeftRadius, cls: (b.className || "").toString().split(/\s+/).filter((c) => /rounded|variant|ghost|outline|tab/.test(c)).slice(0, 3).join(" "), size: `${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`, role: b.getAttribute("role") })).slice(0, 12);
(async () => {
  const browser = await chromium.launch(args.exe ? { executablePath: args.exe } : {}); const report = [];
  for (const mode of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: mode }); await ctx.addInitScript((m) => localStorage.setItem("easysell-theme", m), mode);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }); await page.fill("#email", "owner@demo.local"); await page.fill("#password", "Demo1234!Demo1234!"); await page.click("button[type=submit]"); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    for (const route of ROUTES) for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 800 }); await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
      await page.mouse.click(w - 3, 300); const focus = [];
      for (let i = 0; i < 10; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(350); const f = await page.evaluate(focusedInfo); if (f && !f.sel.startsWith("nextjs-portal")) focus.push(f); if (f && i === 5 && w === 1280) await page.screenshot({ path: `${OUT}/focus-${route.replace(/\W+/g, "-")}__${mode}__${w}.png`, clip: { x: 0, y: 0, width: 1280, height: 400 } }); }
      const pills = await page.evaluate(nonPill);
      report.push({ route, mode, w, focus, nonPill: pills });
    }
    await ctx.close();
  }
  await browser.close(); fs.writeFileSync(`${OUT}/focus.json`, JSON.stringify(report, null, 1));
  for (const r of report) { console.log(`\n${r.route} [${r.mode}] ${r.w}`); for (const f of r.focus) { const ok = (f.ring && f.ring.ratioVsBg >= 3) || (f.outline && f.outline.ratioVsBg >= 3); console.log(` ${ok ? "ok  " : "FAIL"} ${f.sel} "${f.text}" ${f.size} ring=${f.ring ? f.ring.color + " " + f.ring.spread + "px " + f.ring.ratioVsBg + ":1" : "none"} outline=${f.outline ? f.outline.color + " " + f.outline.width + "px " + f.outline.ratioVsBg + ":1" : "none"} border=${f.border ? f.border.color + "/" + f.border.width + "px/" + f.border.ratioVsBg : "-"}`); } if (r.w === 1280) console.log(` nonPill: ${JSON.stringify(r.nonPill)}`); }
})().catch((e) => { console.error(e); process.exit(1); });
