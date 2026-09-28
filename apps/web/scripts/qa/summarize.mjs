// Resume results.json del audit: node scripts/qa/summarize.mjs <results.json>
import fs from "node:fs";
const R = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const routes = [...new Set(R.map((r) => r.route))];
console.log("## Redirecciones / status");
for (const r of R.filter((x) => x.redirected || (x.status && x.status >= 400) || x.error).filter((x, i, a) => a.findIndex((y) => y.route === x.route && y.mode === x.mode) === i)) console.log(` ${r.route} [${r.mode}] status=${r.status} -> ${r.finalUrl}${r.error ? " ERROR " + r.error : ""}`);
console.log("\n## Tabla resumen por ruta (contraste únicos light/dark · tacto 360/390 · scrollX viewports)");
for (const route of routes) {
  const rows = R.filter((r) => r.route === route);
  const uniq = (mode) => { const s = new Set(); rows.filter((r) => r.mode === mode).forEach((r) => (r.contrast || []).filter((c) => !c.disabled).forEach((c) => s.add(c.sel + "|" + c.fg + "|" + c.bg))); return s.size; };
  const touch = new Set(); rows.filter((r) => /^3[69]0/.test(r.viewport)).forEach((r) => (r.touch || []).forEach((t) => touch.add(t.sel + t.size)));
  const sx = rows.filter((r) => r.scrollX?.overflow).map((r) => r.viewport.split("x")[0] + r.mode[0]).join(",");
  const mint = Math.max(...rows.map((r) => r.mint?.buttons?.length ?? 0));
  const cons = rows.reduce((n, r) => n + (r.console || []).filter((c) => c.type !== "warning").length, 0);
  console.log(` ${route.padEnd(50)} L=${uniq("light")} D=${uniq("dark")} touch=${touch.size} scrollX=[${sx}] mintBtnsMax=${mint} consoleErr=${cons}`);
}
for (const mode of ["light", "dark"]) {
  console.log(`\n## Contraste fallido (${mode}) — únicos por selector+colores`);
  const seen = new Map();
  for (const r of R.filter((x) => x.mode === mode)) for (const c of r.contrast || []) { const k = c.sel + "|" + c.fg + "|" + c.bg; if (!seen.has(k)) seen.set(k, { ...c, routes: new Set(), vps: new Set() }); seen.get(k).routes.add(r.route.split("/").slice(0, 2).join("/")); seen.get(k).vps.add(r.viewport.split("x")[0]); }
  for (const c of [...seen.values()].sort((a, b) => a.ratio - b.ratio)) console.log(` ${c.ratio.toFixed(2).padStart(5)} (need ${c.need}) fg=${c.fg} bg=${c.bg} ${c.size}px/${c.weight}${c.disabled ? " [disabled]" : ""}${c.placeholder ? " [placeholder]" : ""} | ${c.sel} | "${c.text}" | ${[...c.routes].join(",")} @${[...c.vps].join("/")}`);
  console.log(`\n## Texto sobre gradiente (${mode})`);
  const g = new Map(); for (const r of R.filter((x) => x.mode === mode)) for (const c of r.gradientText || []) g.set(c.sel + c.text, { ...c, route: r.route });
  for (const c of g.values()) console.log(` ${c.route} ${c.sel} "${c.text}" fg=${c.fg} bgApprox=${c.bgApprox} ~${c.ratioApprox} ${c.gradient || c.reason}`);
}
console.log("\n## Tacto (<44px) en 360/390 — únicos");
const tseen = new Map();
for (const r of R.filter((x) => /^3[69]0/.test(x.viewport))) for (const t of r.touch || []) { const k = t.sel + "|" + t.size; if (!tseen.has(k)) tseen.set(k, { ...t, routes: new Set() }); tseen.get(k).routes.add(r.route.split("/").slice(0, 2).join("/")); }
for (const t of tseen.values()) console.log(` ${t.size.padEnd(8)} ${t.sel} "${t.text}" | ${[...t.routes].slice(0, 6).join(",")}${t.routes.size > 6 ? "…" : ""}`);
console.log("\n## Scroll horizontal");
for (const r of R.filter((x) => x.scrollX?.overflow)) console.log(` ${r.route} [${r.mode}] ${r.viewport} scrollWidth=${r.scrollX.scrollWidth} culprits=${(r.scrollX.culprits || []).slice(0, 3).map((c) => c.sel + "→" + c.right).join("; ")}`);
console.log("\n## Menta");
for (const r of R.filter((x) => x.viewport.startsWith("1280") || x.viewport.startsWith("390"))) { const m = r.mint || {}; if ((m.buttons?.length ?? 0) > 1 || m.bodyText?.length || m.otherSurfaces?.length) console.log(` ${r.route} [${r.mode}] ${r.viewport} buttons=${JSON.stringify(m.buttons)} bodyText=${JSON.stringify(m.bodyText?.slice(0, 3))} surfaces=${JSON.stringify(m.otherSurfaces)}`); }
console.log("\n## Tipografía");
for (const r of R.filter((x) => x.mode === "light" && (x.viewport.startsWith("390") || x.viewport.startsWith("1280")))) { const t = r.typo; if (!t) continue; const issues = []; if (t.bodyFontSize < 16) issues.push(`body=${t.bodyFontSize}`); if (t.paragraphs.small.length) issues.push(`p<16px: ${t.paragraphs.small.map((p) => p.fs + "px \"" + p.text.slice(0, 25) + "\"").join(" · ")}`); if (t.paragraphs.tightLH.length) issues.push(`lh<1.5: ${t.paragraphs.tightLH.map((p) => p.fs + "px/" + p.lh + " \"" + p.text.slice(0, 20) + "\"").join(" · ")}`); if (t.smallInputs.length) issues.push(`inputs<16: ${JSON.stringify(t.smallInputs)}`); if (t.nonMonoIds.length) issues.push(`ids sin mono: ${t.nonMonoIds.map((x) => x.text + "(" + x.ff.slice(0, 15) + ")").join(" · ")}`); if (issues.length) console.log(` ${r.route} ${r.viewport}: ${issues.join(" || ")}`); }
console.log("\n## Foco por teclado (Tab) — ring/outline vs fondo");
for (const r of R.filter((x) => x.keyboardFocus && Array.isArray(x.keyboardFocus) && (x.viewport.startsWith("1280") || x.viewport.startsWith("390")))) for (const f of r.keyboardFocus) { const ring = f.ring ? `ring ${f.ring.color} ${f.ring.spread}px ${f.ring.ratioVsBg}:1` : "ring:none"; const ol = f.outline ? `outline ${f.outline.color} ${f.outline.width}px ${f.outline.ratioVsBg}:1` : "outline:none"; const bad = (!f.ring || f.ring.ratioVsBg < 3) && (!f.outline || f.outline.ratioVsBg < 3); if (bad || process.env.ALL) console.log(` ${bad ? "FAIL" : "ok  "} ${r.route} [${r.mode}] ${r.viewport} ${f.sel} "${f.text}" ${ring} ${ol} border=${f.border.color}/${f.border.width}px/${f.border.ratioVsBg}:1 bg=${f.outerBg}`); }
console.log("\n## Bordes de input (ratio vs fondo) y radios");
for (const r of R.filter((x) => x.viewport.startsWith("1280") || x.viewport.startsWith("390"))) for (const c of (r.controls || []).filter((c) => c.kind === "input")) console.log(` ${r.route} [${r.mode}] ${r.viewport} ${c.sel} ${c.size} border=${c.border} ${c.borderWidth}px ${c.borderRatio}:1 radius=${c.radius} font=${c.fontSize}`);
console.log("\n## Hover");
for (const r of R.filter((x) => x.hovers?.length)) for (const h of r.hovers) if (h.ratio && h.ratio < 4.5) console.log(` ${r.route} [${r.mode}] ${r.viewport} ${h.sel} "${h.text}" fg=${h.fg} bg=${h.bg} ${h.ratio}:1`);
console.log("\n## Radios (muestras 1280 light)");
for (const r of R.filter((x) => x.mode === "light" && x.viewport.startsWith("1280"))) console.log(` ${r.route}: btn=${JSON.stringify(r.radii?.buttons)} input=${JSON.stringify(r.radii?.inputs)} cards=${JSON.stringify(r.radii?.cards)}`);
console.log("\n## Consola (errores únicos)");
const cs = new Map(); for (const r of R) for (const c of r.console || []) { const k = c.type + "|" + c.text.slice(0, 120); if (!cs.has(k)) cs.set(k, { ...c, routes: new Set() }); cs.get(k).routes.add(r.route.split("/").slice(0, 2).join("/")); }
for (const c of cs.values()) console.log(` [${c.type}] ${c.text.slice(0, 200)} | ${[...c.routes].slice(0, 5).join(",")}`);
