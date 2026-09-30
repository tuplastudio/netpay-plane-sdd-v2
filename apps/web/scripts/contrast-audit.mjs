#!/usr/bin/env node
/**
 * Auditoría de contraste WCAG 2.2 AA de src/app/globals.css.
 *
 * Lee las variables HSL de ambos modos (`:root, .dark` y `.light`), calcula
 * los pares críticos y falla (exit 1) si algún par de TEXTO baja de 4.5:1 o
 * alguno de UI (borde de control, foco, punto de estado) baja de 3:1.
 *
 * Uso: node scripts/contrast-audit.mjs [--verbose]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../src/app/globals.css"), "utf8");
const verbose = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------
// Parseo: bloque `:root, .dark { … }` y bloque `.light { … }` dentro de @layer base.
// ---------------------------------------------------------------------------
function block(selectorRe) {
  const m = css.match(selectorRe);
  if (!m) throw new Error(`No encontré el bloque ${selectorRe}`);
  let depth = 0;
  let i = m.index + m[0].length - 1; // posición de la "{"
  const start = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  throw new Error("Bloque sin cerrar");
}

function parseVars(body) {
  const vars = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  // Resuelve alias `var(--x)` de un nivel.
  for (const k of Object.keys(vars)) {
    const a = vars[k].match(/^var\(--([a-z0-9-]+)\)$/);
    if (a && vars[a[1]]) vars[k] = vars[a[1]];
  }
  return vars;
}

const dark = parseVars(block(/:root\s*,\s*\.dark\s*\{/));
const light = parseVars(block(/\n\s*\.light\s*\{/));

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------
function hslToRgb(str) {
  const m = str.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`No es HSL de Tailwind: "${str}"`);
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** Compone un color con alfa sobre un fondo (para `text-white/85`, `border-x/30`). */
const over = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// ---------------------------------------------------------------------------
// Pares críticos. Tipo: "text" (≥4.5) o "ui" (≥3).
// ---------------------------------------------------------------------------
const TEXT = 4.5, UI = 3;
// Texto sobre las cuatro superficies (incluido `accent`, el hover de menús y filas).
const surfaces = ["background", "card", "secondary", "accent"];
const textOnSurfaces = ["foreground", "body-text", "muted-foreground", "primary", "legal-link", "brand-text"];
// Tonos de estado como texto (`text-destructive`, `text-success`, …): sobre
// canvas, surface-1 y surface-2 (TOKEN-SPEC). No sobre `accent`: un botón
// destructivo hace hover con su propio `*-subtle`, no con `accent`.
const toneText = ["destructive", "success", "warning", "info"];

const pairs = [];
for (const fg of textOnSurfaces) for (const bg of surfaces) pairs.push({ fg, bg, type: "text" });
for (const fg of toneText) for (const bg of ["background", "card", "secondary"]) pairs.push({ fg, bg, type: "text" });
// Texto de estado sobre surface-2 (StatusBadge) y sobre su tinte (Badge / Alert).
for (const t of ["success", "warning", "info", "neutral"]) {
  pairs.push({ fg: `${t}-foreground`, bg: "secondary", type: "text" });
  pairs.push({ fg: `${t}-foreground`, bg: `${t}-subtle`, type: "text" });
  pairs.push({ fg: t, bg: `${t}-subtle`, type: "ui", label: `punto ${t}` });
}
// StatusBadge vive sobre `neutral-subtle`, no sobre `secondary`.
for (const t of ["success", "warning", "info", "neutral"]) pairs.push({ fg: `${t}-foreground`, bg: "neutral-subtle", type: "text" });
pairs.push({ fg: "destructive-subtle-foreground", bg: "neutral-subtle", type: "text" });
pairs.push({ fg: "destructive-subtle-foreground", bg: "secondary", type: "text" });
// Botón deshabilitado: relleno hairline + texto muted.
pairs.push({ fg: "muted-foreground", bg: "primary-disabled", type: "text", label: "muted (botón deshabilitado)" });
pairs.push({ fg: "destructive-subtle-foreground", bg: "destructive-subtle", type: "text" });
pairs.push({ fg: "destructive", bg: "destructive-subtle", type: "ui", label: "punto destructive" });
// Rellenos con tinta.
pairs.push({ fg: "brand-foreground", bg: "brand", type: "text" });
pairs.push({ fg: "cta-foreground", bg: "cta", type: "text" });
pairs.push({ fg: "cta-foreground", bg: "cta-hover", type: "text" });
pairs.push({ fg: "cta-foreground", bg: "cta-active", type: "text" });
pairs.push({ fg: "primary-foreground", bg: "primary-strong", type: "text" });
pairs.push({ fg: "destructive-foreground", bg: "destructive", type: "text" });
pairs.push({ fg: "destructive-foreground", bg: "destructive-active", type: "text" });
pairs.push({ fg: "highlight-foreground", bg: "highlight", type: "text" });
pairs.push({ fg: "highlight-foreground", bg: "highlight-strong", type: "text" });
pairs.push({ fg: "on-hero-foreground", bg: "on-hero", type: "text" });
pairs.push({ fg: "popover-foreground", bg: "popover", type: "text" });
pairs.push({ fg: "muted-foreground", bg: "popover", type: "text" });
pairs.push({ fg: "muted-foreground", bg: "muted", type: "text" });
// Placeholder de los campos (`placeholder:text-muted-foreground` sobre el
// lienzo, ver `fieldClassName` en ui/input.tsx) y campo deshabilitado
// (texto muted sobre relleno `muted`). Un placeholder es texto: ≥4.5:1.
pairs.push({ fg: "muted-foreground", bg: "background", type: "text", label: "placeholder de campo" });
pairs.push({ fg: "muted-foreground", bg: "muted", type: "text", label: "campo deshabilitado" });
// UI: borde de control y anillo de foco. Los checks, radios y puntos activos
// usan `primary` (menta profunda), no `brand`: la menta de relleno #00d4a4 es
// fondo de píldora (su texto ink da 9.8:1) y nunca un objeto gráfico suelto
// sobre superficie clara.
for (const bg of ["background", "card", "secondary"]) {
  pairs.push({ fg: "input", bg, type: "ui", label: "borde de control" });
  pairs.push({ fg: "ring", bg, type: "ui", label: "anillo de foco" });
  pairs.push({ fg: "primary", bg, type: "ui", label: "check/radio/punto activo" });
}

// Bandas hero (constantes del gradiente; iguales en ambos modos).
const heroDarkStops = ["#0a2b26", "#0d4a3f", "#0e6453"].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const skyStops = ["#dbeeff", "#fff6ea"].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const white = [255, 255, 255], inkLight = [0x0f, 0x12, 0x11];

let failures = 0;
function report(mode, name, ratio, min, type) {
  const ok = ratio >= min;
  if (!ok) failures++;
  if (verbose || !ok) console.log(`${ok ? "  ok " : "FAIL "} [${mode}] ${name.padEnd(52)} ${ratio.toFixed(2)}:1  (${type} ≥${min})`);
  return ok;
}

for (const [mode, vars] of [["oscuro", dark], ["claro", light]]) {
  console.log(`\n== Modo ${mode}`);
  let count = 0;
  for (const p of pairs) {
    if (!vars[p.fg] || !vars[p.bg]) { console.log(`FAIL [${mode}] falta variable --${p.fg} o --${p.bg}`); failures++; continue; }
    const fg = hslToRgb(vars[p.fg]), bg = hslToRgb(vars[p.bg]);
    const name = `${p.label ?? p.fg} / ${p.bg}  ${hex(fg)} on ${hex(bg)}`;
    report(mode, name, contrast(fg, bg), p.type === "text" ? TEXT : UI, p.type);
    count++;
  }
  // Hero dark: blanco y blanco al 85% sobre el punto más claro.
  for (const stop of heroDarkStops) {
    report(mode, `blanco / hero-dark ${hex(stop)}`, contrast(white, stop), TEXT, "text");
    report(mode, `blanco 85% / hero-dark ${hex(stop)}`, contrast(over(white, 0.85, stop), stop), TEXT, "text");
    report(mode, `on-hero píldora tinta / on-hero`, contrast(hslToRgb(vars["on-hero-foreground"]), hslToRgb(vars["on-hero"])), TEXT, "text");
    count += 3;
  }
  for (const stop of skyStops) {
    report(mode, `ink #0f1211 / hero-sky ${hex(stop)}`, contrast(inkLight, stop), TEXT, "text");
    count++;
  }
  console.log(`   ${count} pares evaluados`);
}

if (failures) {
  console.error(`\n${failures} par(es) por debajo de WCAG AA.`);
  process.exit(1);
}
console.log("\nContraste OK: todo texto ≥4.5:1 y toda UI ≥3:1 en ambos modos.");
