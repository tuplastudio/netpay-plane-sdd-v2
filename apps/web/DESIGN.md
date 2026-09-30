# DESIGN.md — referencia visual (estilo Mintlify)

> Referencia externa aportada por el equipo el 2026-09-28. Los `{tokens}` son
> placeholders; los valores concretos que usa este portal (claro y oscuro)
> están en `TOKEN-SPEC.md` y en `src/components/DESIGN-SYSTEM.md`.

## Overview

Mintlify positions itself at the intersection of polished marketing presentation and developer-grade documentation density. The home and startups pages open with cinematic atmospheric heroes — soft sky-gradient backdrops with cloud illustrations on the homepage, dark teal-to-mint gradients with a rocket launch on the startups page — that feel more like a SaaS landing aesthetic than a developer tool. Then the deeper surfaces (pricing comparison, live documentation pages) collapse into dense, high-information layouts where Inter body type carries 14–16px copy across long-form prose, syntax-highlighted code blocks, and 3-column documentation grids.

The brand's signature mint green ({colors.brand-green}) appears sparingly but decisively — on the hero "Get started" pill button, the green checkmark icons inside feature lists, the "Featured" pricing tier border, and active state indicators inside docs UI. Black-pill primary buttons dominate the marketing flow; white-on-dark inversions appear on dark hero bands. The signature pairing of Inter (body, headings) with Geist Mono (code blocks, inline references, type signatures) reinforces the developer-tool DNA without requiring a third typeface.

**Key Characteristics:**
- Atmospheric gradient hero bands (sky-blue to cream on homepage; teal-to-mint on startups) provide cinematic marketing presentation
- Signature Mintlify mint green ({colors.brand-green}) reserved for accent CTAs, active states, and feature confirmations
- Black-pill primary buttons ({colors.primary} + `{rounded.full}`) for marketing CTAs
- Inter for all UI prose; Geist Mono for code blocks, inline code, and type/property signatures
- 3-column documentation layout (sidebar / prose / TOC) with dense 14px body type for long-form developer reading
- Tightly-controlled radius scale: marketing uses `{rounded.lg}` (12px), pill buttons use `{rounded.full}` — no in-between corner softening
- Vibrant testimonial card (`{colors.testimonial-orange}`) breaks color rhythm intentionally for emotional impact

## Colors

### Brand & Accent
- **Mintlify Mint** ({colors.brand-green}): Signature accent — hero "Get started" pill button, green checkmarks in feature lists, featured pricing tier border accent, sidebar active indicator dots.
- **Deep Mint** ({colors.brand-green-deep}): Pressed/active variant of the mint accent.
- **Soft Mint** ({colors.brand-green-soft}): Subtle background tint for success states and confirmation surfaces.
- **Brand Tag** ({colors.brand-tag}): Documentation tag and reference color.
- **Brand Annotate** ({colors.brand-annotate}): Inline code annotation green.
- **Brand Warn** ({colors.brand-warn}): Code warning highlight (deprecated, caution).
- **Brand Error** ({colors.brand-error}): Red used for required-field labels and error highlight.
- **Testimonial Orange** ({colors.testimonial-orange}): Warm coral-orange used on the testimonial card and warm callout surfaces.

### Surface
- **Canvas White** ({colors.canvas}): Primary page and card background.
- **Canvas Dark** ({colors.canvas-dark}): Promo banner, dark inversion surfaces, code editor wrapper.
- **Surface** ({colors.surface}): Subtle section backgrounds, search-pill rest, code-inline background, sidebar active state.
- **Surface Soft** ({colors.surface-soft}): Quieter section backgrounds and FAQ accordion.
- **Surface Code** ({colors.surface-code}): Dark code-block wrapper background.
- **Hairline** ({colors.hairline}): 1px borders and primary dividers.
- **Hairline Soft** ({colors.hairline-soft}): Quieter table-row dividers and secondary section breaks.

### Hero Atmospheric
- **Hero Sky From / To**: Atmospheric sky-blue to soft cream gradient on the homepage hero.
- **Hero Dark From / To**: Dark teal to mint gradient on the startups hero.

### Text
- **Ink** ({colors.ink}): Primary headlines and CTA text.
- **Charcoal** ({colors.charcoal}): Body text, code-inline foreground.
- **Slate** ({colors.slate}): Secondary text and metadata.
- **Steel** ({colors.steel}): Tertiary text, table headers, sidebar inactive items, footer links.
- **Stone** ({colors.stone}): Captions, muted labels.
- **Muted** ({colors.muted}): De-emphasized labels and disabled text.
- **On Dark** ({colors.on-dark}): White text on dark surfaces.
- **On Dark Muted** ({colors.on-dark-muted}): Reduced-opacity white for code-block headers and metadata on dark.

### Semantic
- Error tones derive from `{colors.brand-error}` for input borders, required-field labels, and validation messaging.

## Typography

**Inter** (primary): body, headings, navigation, button labels, captions. Fallbacks: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif.

**Geist Mono** (code): code blocks, inline code references, type signatures, property names. Fallbacks: 'SF Mono', Menlo, Consolas, monospace.

No italic variants — emphasis comes from weight (500/600), color shift, or background highlighting.

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `hero-display` | 72px | 600 | 1.05 | -2px | Marketing hero display |
| `display-lg` | 56px | 600 | 1.10 | -1.5px | Major section opener |
| `heading-1` | 48px | 600 | 1.10 | -1px | Page-level headlines |
| `heading-2` | 36px | 600 | 1.20 | -0.5px | Section headlines |
| `heading-3` | 28px | 600 | 1.25 | 0 | Subsection headers |
| `heading-4` | 22px | 600 | 1.30 | 0 | Card titles |
| `heading-5` | 18px | 600 | 1.40 | 0 | Smaller feature headers, FAQ titles |
| `subtitle` | 18px | 400 | 1.50 | 0 | Hero subtitle, lead body |
| `body-md` | 16px | 400 | 1.50 | 0 | Primary body text |
| `body-md-medium` | 16px | 500 | 1.50 | 0 | Body emphasis |
| `body-sm` | 14px | 400 | 1.50 | 0 | Secondary body, table cells, navigation |
| `body-sm-medium` | 14px | 500 | 1.50 | 0 | Active sidebar nav, button labels, tab labels |
| `caption` | 13px | 400 | 1.40 | 0 | Helper text, fine print |
| `caption-bold` | 13px | 600 | 1.40 | 0 | Badge labels |
| `micro` | 12px | 500 | 1.40 | 0 | Footer microcopy, label chips |
| `micro-uppercase` | 11px | 600 | 1.40 | 0.5px | Sidebar section headers, "REQUIRED" labels |
| `button-md` | 14px | 500 | 1.30 | 0 | Pill button labels |
| `code-md` | 14px | 400 | 1.50 | 0 | Code block content |
| `code-sm` | 13px | 400 | 1.40 | 0 | Smaller code, type signatures |
| `code-inline` | 13px | 500 | 1.30 | 0 | Inline code references in body |

Principles: tight hero leading (1.05); negative letter-spacing inversely with size; body 1.50 line-height on 14–16px never compressed; Inter / Geist Mono pairing; uppercase micro labels +0.5px.

## Layout

- Base unit 4px (8px primary increment). Tokens: xxs 4 · xs 8 · sm 12 · md 16 · lg 20 · xl 24 · xxl 32 · xxxl 40 · section-sm 48 · section 64 · section-lg 96 · hero 120.
- Card padding: 24px compact; 32px pricing/feature panels.
- Marketing 1280px max-width, 32px gutters. Docs: sidebar ~240 / prose ~720 / TOC ~200.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No shadow; hairline border | Default cards, table rows, form inputs |
| 1 (subtle) | `rgba(0,0,0,0.04) 0 1px 2px` | Hover-elevated tiles |
| 2 (card) | `rgba(0,0,0,0.08) 0 4px 12px` | Standard feature cards |
| 3 (mockup) | `rgba(0,0,0,0.12) 0 24px 48px -8px` | Hero product mockup |
| 4 (brand-tinted) | `rgba(0,212,164,0.08) 0 8px 24px` | Featured pricing tier glow |

## Shapes

| Token | Value | Use |
|---|---|---|
| `rounded.xs` | 4px | Inline code chips, micro tags |
| `rounded.sm` | 6px | Sidebar nav items, type badges |
| `rounded.md` | 8px | Inputs, search pill, code blocks, secondary cards |
| `rounded.lg` | 12px | Standard cards, pricing tiers, FAQ items |
| `rounded.xl` | 16px | Larger feature panels |
| `rounded.xxl` | 24px | Featured product showcase tiles |
| `rounded.full` | 9999px | All buttons, pill tabs, badges |

## Components (resumen)

- `button-primary`: black pill, on-primary text, 14px/500, padding 10px 20px, full radius. Pressed → charcoal. Disabled → hairline bg + muted text.
- `button-accent-green`: mint pill with primary (ink) text.
- `button-on-dark`: white pill on dark bands.
- `button-secondary`: outlined pill, ink text, hairline border.
- `button-ghost`: transparent, ink text, `rounded.md`.
- `button-icon-circular`: 32×32 (44 mobile), canvas bg, hairline border.
- `card-base`: canvas bg, `rounded.lg`, padding 24, hairline border. `card-feature`: surface bg, padding 32.
- `pricing-card-featured`: 2px mint border + brand-tinted shadow.
- `text-input`: 40px (44 mobile), canvas bg, hairline border, `rounded.md`; focused → 2px mint border.
- `search-pill`: surface bg, steel text, 36px, `rounded.md`.
- Tabs: underline style (steel inactive, ink active + 2px ink underline) or pill style (active = primary bg + on-primary text).
- Badges: `badge-discount` mint bg + ink text; `badge-required` error bg + white text, 11px uppercase; `badge-type` surface bg + steel text mono; `badge-tag` blue tint + tag text.
- Code: dark surface-code, on-dark text, `rounded.md`, 14px mono; inline code surface bg + charcoal, 13px/500, `rounded.xs`, hairline border.
- Sidebar nav: inactive steel 14px, `rounded.sm`; active surface bg + ink 500. Section headers 11px uppercase steel.
- Hero bands: `hero-band-sky` (180° sky→cream, ink text) · `hero-band-dark` (135° teal→mint, on-dark text, white pill CTA).

## Do's and Don'ts

Do: reserve mint for accent CTAs and active states; black pill dominant CTA on light, white pill on dark; `rounded.full` on every button; Inter + Geist Mono only; gradients only on hero bands; `rounded.lg` on cards, `rounded.md` on compact UI; body 16px/1.5.

Don't: mint on body text or large surfaces; extra accent colors beyond mint, tag-blue, error-red, testimonial orange; heavy shadows on flat cards; line-height under 1.5; competing accents in a hero; Inter for code or Geist Mono for prose.

## Responsive Behavior

| Name | Width | Key Changes |
|---|---|---|
| Mobile (small) | < 480px | Single column. Hero 36px. Hamburger nav. Cards stack 1-up. |
| Mobile (large) | 480 – 767px | Feature tiles 2-up. Hero 44px. |
| Tablet | 768 – 1023px | 2-column grids. Sidebar → drawer. Hero 56px. |
| Desktop | 1024 – 1279px | 3-column docs grid. Hero 72px. |
| Wide Desktop | ≥ 1280px | Wider gutters, fixed 240px sidebar. |

Touch targets: pill buttons 36–40px desktop → 44px mobile; circular icon buttons 32 → 44; inputs 40 → 44; nav items ~32 → 44 in mobile drawers.

## Known Gaps

- No published dark-mode palette (derived in `TOKEN-SPEC.md`).
- Transitions: 150–200ms ease recommended.
- Form success state: green border + success badge.
- Syntax highlighting palette not formalized.

## Tipografía y formularios — 2026-09-29

Cambio transversal en `apps/web`: una sola escala tipográfica y un solo
contrato de campo. Detalle en `src/components/DESIGN-SYSTEM.md` (§1
"Tipografía" y §2 `Input`).

**Diagnóstico.** El sidebar iba en 14px/500 mientras el cuerpo de las
pantallas tenía 409 usos de `text-xs` (12px) contra 245 de `text-sm`: casi
todo el texto secundario (ayuda, errores, meta, celdas) era 12px y la barra,
en 14 medium, se veía "más grande que la plataforma".

**Escala final (portal operativo).**

| Peldaño | Token | Tamaño |
| --- | --- | --- |
| Título de pantalla | `text-h1` | 24→28px / 600 |
| Título de sección, tarjeta, sheet, diálogo | `text-h2` | 18px / 600 |
| Sub-bloque | `text-h3` | 16px / 600 |
| Prosa, descripción bajo el h1 | `text-body` | 16px |
| UI por defecto (nav, celdas, campos, botones, menús, etiquetas) | `text-body-sm` | 14px |
| Ayuda, error, tooltip, migas, cabecera de tabla, badge | `text-caption` | 13px |
| Chips `sm`, contadores, marcas de tiempo | `text-micro` | 12px / 500 |
| Rótulos de grupo (sidebar, menús) | `text-micro-uppercase` | 11px / 600 |
| Código, ids, SKUs | `text-code-md` / `text-code-sm` (`font-mono`) | 14 / 13px |

`display-*` (26→72px) queda solo para páginas públicas. Los alias de
Tailwind se remapearon a la escala (`text-xs` = 13, `text-sm` = 14,
`text-base` = 16, `text-lg` = 18) para que el código existente cayera en
peldaños reales sin reescribir cientos de archivos; en código nuevo se usa
el nombre semántico. Se eliminaron los `text-[10px]`/`text-[11px]` de
conversaciones, cotizaciones, agente y páginas públicas (quedan solo en
ejes de gráficas).

**Chrome.** Sidebar en body-sm 400 (steel); activa en 500 + tinta plena;
grupos en micro-uppercase; nombre de empresa body-sm 600. Topbar: nombre de
usuario body-sm, rol en caption. `PageHeader` baja de display-md (36px) a
h1 (28px); `Section` sube de 17px a h2 (18px) y su descripción baja de 16 a
14 para no superar a las tablas que acompaña.

**Formularios.** `Input`, `Textarea` y `Select` comparten `fieldClassName`:
44px móvil / 40px desde `sm` (igual que `Button`), 16px en móvil y body-sm
en escritorio, placeholder `muted-foreground` (6.3:1 claro / 8.2:1 oscuro,
par nuevo en `scripts/contrast-audit.mjs`), foco borde + anillo menta,
error por `aria-invalid`, deshabilitado con relleno `muted` y texto muted
(sin opacidad). Ayuda y error en caption. Placeholders revisados en los
formularios de `src/app` (clientes, cotizaciones, pagos, admin, canales,
conversaciones, super-admin, checkout, autenticación) con formato `Ej. …`,
sin repetir la etiqueta y sin datos de negocio reales (se retiró "Aglos"
del alta de empresa y "pinturas" del asistente del bot).

**Pendiente (fuera de alcance).** `catalog/_components/variants-editor.tsx`,
`create-product-sheet.tsx` y `edit-product-sheet.tsx` conservan
placeholders en minúscula con ejemplos de pinturas (`ej. PINT-MATE-1L-BLA`);
los está reescribiendo el agente de productos.
