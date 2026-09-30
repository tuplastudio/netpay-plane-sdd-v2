# Sistema de diseño — portal operativo

Referencia de la capa de primitivas. Todo lo de aquí ya existe y compila: no
reimplementes nada, no copies clases de una pantalla a otra.

- Identidad: **Mintlify-like**. Neutros fríos (gris-verde, nunca gris puro),
  **menta como único acento**, CTA en **píldora negra (claro) / blanca
  (oscuro)**, tarjetas planas con hairline, **Inter** para todo el texto y
  **Geist Mono** para código/ids. **Claro y oscuro de primera clase**: los dos
  modos cumplen WCAG 2.2 AA y se prueban en cada cambio
  (`node scripts/contrast-audit.mjs`).
- **Oscuro por defecto, claro al mismo nivel.** `ThemeProvider`
  (`components/theme-provider.tsx`) pone `dark` o `light` en `<html>` antes del
  primer paint (clave `easysell-theme`: sistema / claro / oscuro) y el selector
  vive en la barra superior (`ThemeToggle`).
- Fuente del tema: `src/app/globals.css` (variables CSS) + `tailwind.config.ts`.
  Referencia visual: `apps/web/DESIGN.md`; valores: `apps/web/TOKEN-SPEC.md`.
- Idioma de UI: **es-MX**. Todo texto visible en español.
- **Mobile first**: 16px de cuerpo, 44px de tacto en móvil (40 desde `sm`),
  canal lateral 16px, sin scroll horizontal. Se escribe primero el valor
  móvil y luego `sm:` / `md:` / `lg:`.
- Si te falta una prop, **pídela**; no hagas un fork del componente en tu pantalla.

---

## 0. Reglas no negociables

1. **Nunca un hex crudo.** `#00d4a4`, `bg-emerald-100`, `bg-amber-50` están
   prohibidos en TSX. Solo tokens: `bg-brand`, `text-warning-foreground`, …
   (única excepción: `branding-section.tsx`, el color de marca del tenant).
2. **Nunca un `<table>` a pelo.** Listados → `DataTable`. Tablas a medida →
   `Table`/`TableRow`/`TableCell` de `@/components/ui/table`.
3. **Nunca `toLocaleString()` / `toLocaleDateString()` en línea.** Fechas →
   `DateTime` / `formatDateTime`. Importes → `Money` / `formatMoney`.
4. **Nunca un `<div className="rounded-lg border bg-card p-4">`.** Eso es
   `Section` (o `Card` si de verdad no lleva encabezado).
5. **Nunca el enum crudo en pantalla.** `DRAFT` no, "Borrador" sí →
   `StatusBadge` / `statusLabel`.
6. **Todo elemento interactivo** necesita anillo de foco visible y nombre
   accesible. Un botón que solo tiene ícono lleva `aria-label`. Un `Input` o
   `Select` lleva `<Label htmlFor>` o `aria-label`.
7. **Menta solo como acento.** Relleno únicamente en `variant="accent"` (uno
   por pantalla), checks de lista, borde de tarjeta destacada y punto activo de
   nav. Nunca en texto de cuerpo ni como fondo de sección.

## 1. Estructura y escalas

### Estructura de página

```tsx
export default function OrdersPage() {
  return (
    <div>
      <PageHeader title="Pedidos" description="…" actions={<Button>Nuevo</Button>} />
      <div className="space-y-6">
        <Section title="Resumen">…</Section>
        <Section title="Listado" padded={false}>
          <DataTable … />
        </Section>
      </div>
    </div>
  );
}
```

`PageHeader` ya trae su propio `mb-6`. Entre secciones: **`space-y-6`**.
Dentro de una sección: `space-y-4`. Entre etiqueta y control: `space-y-1.5`.

### Color

Los nombres de token de Tailwind (`background`, `card`, `secondary`, …) son
los mismos de siempre; aquí está a qué valor apunta cada uno en cada modo.

#### Paleta — modo claro (`.light`)

| Rol | Hex | Token(s) Tailwind | Uso |
| --- | --- | --- | --- |
| canvas | `#ffffff` | `bg-background`, `bg-canvas`, `bg-popover` | Página, inputs, menús |
| surface-1 | `#f4f6f5` | `bg-card` | Tarjetas, tiles |
| muted | `#f7f8f8` | `bg-muted` | Zonas hundidas, hover de fila |
| surface-2 | `#e9ecea` | `bg-secondary` | Insignias de estado, pestaña activa (pill), hover de botón secundario |
| hover | `#e2e6e4` | `bg-accent` | Hover de menús y filas |
| hairline | `#e2e6e4` | `border-border`, `border-hairline` | Bordes de tarjeta, divisores |
| hairline-soft | `#edf0ee` | `border-hairline-soft` | Divisores de fila |
| hairline-strong | `#b9c0bd` | `border-hairline-strong` | Divisores que deben verse más |
| borde de control | `#7a827f` | `border-input` | Inputs, checkbox, radio (3.9:1 canvas · 3.3:1 surface-2) |
| ink | `#0f1211` | `text-foreground`, `bg-primary-strong`, `bg-cta` | Titulares, cuerpo, píldora negra |
| on-primary | `#ffffff` | `text-primary-foreground`, `text-cta-foreground` | Tinta sobre la píldora negra |
| charcoal | `#2a2f2d` | `text-body-text`, hover de píldora | Prosa larga |
| steel | `#5a625f` | `text-muted-foreground` | Texto secundario, meta, cabeceras de tabla (6.3 · 5.8 · 5.3) |
| stone | `#6f7774` | `text-muted-soft` | Decorativo / deshabilitado. **No** es texto sobre surface-2 |
| **menta** | `#00d4a4` | `bg-brand` + `text-brand-foreground` (ink) | CTA `accent`, badge `brand`, borde destacado |
| **menta profunda** | `#0a6b54` | `text-primary`, `ring`, `text-legal-link`, `text-brand-text` | Enlaces, foco, selección, checks (6.5 · 6.0 · 5.4) |
| menta suave | `#e3f8f1` | `bg-brand-soft`, `bg-success-subtle` | Fondo de éxito / opción elegida |
| success | `#0f7a4f` · texto `#0b6641` | `success`, `success-foreground` | Estado |
| warning | `#a4500a` · texto `#8a4308` · fondo `#fdf1e0` | `warning`, `warning-foreground`, `warning-subtle` | Estado |
| error | `#c62a36` · texto `#b0212c` · fondo `#fdeaec` | `destructive`, `destructive-subtle-foreground`, `destructive-subtle` | Estado, texto destructivo (5.6 · 5.1 · 4.7) |
| info / tag | `#2b62b8` · texto `#23529c` · fondo `#e8f0fc` | `info`, `info-foreground`, `info-subtle` | Estado, tags |
| neutral | `#5a625f` · texto `#3f4644` · fondo `#eef1f0` | `neutral*` | Estado inerte |
| coral de resalte | `#ff6a3d` + tinta ink | `bg-highlight` + `text-highlight-foreground` | Badge "nuevo". Nunca texto blanco encima |

#### Paleta — modo oscuro (`:root, .dark`)

| Rol | Hex | Token(s) Tailwind | Uso |
| --- | --- | --- | --- |
| canvas | `#0b0e0d` | `bg-background`, `bg-canvas` | Página, inputs |
| surface-1 | `#141817` | `bg-card` | Tarjetas, tiles, pestañas (pill) |
| muted | `#101312` | `bg-muted` | Zonas hundidas, hover de fila |
| surface-2 | `#1c2120` | `bg-secondary`, `bg-popover` | Insignias, menús, hover de botón secundario |
| hover | `#242a28` | `bg-accent` | Hover de menús y filas |
| hairline | `#282e2c` · soft `#1f2523` · strong `#3a423f` | `border-hairline*` | Bordes y divisores |
| borde de control | `#6e7875` | `border-input` | Inputs (4.3 · 3.9 · 3.6) |
| ink | `#f7f9f8` | `text-foreground` | Titulares, cuerpo |
| body | `#e2e6e4` | `text-body-text` | Prosa larga |
| steel | `#a2aaa7` | `text-muted-foreground` | Secundario (8.2 · 7.5 · 6.9 · 6.2 hover) |
| stone | `#8a928f` | `text-muted-soft` | Decorativo |
| píldora primaria | `#ffffff` · tinta `#0b0e0d` | `bg-primary-strong`, `bg-cta` | CTA (hover `#e6e9e8`, activo `#d3d8d6`) |
| **menta** | `#00d4a4` + tinta `#0b0e0d` | `bg-brand`, `text-brand-foreground` | CTA `accent` (10.1:1) |
| **menta texto** | `#2fe0b4` | `text-primary`, `ring`, `text-legal-link`, `text-brand-text` | Enlaces, foco, checks (11.5 · 10.6 · 9.7) |
| menta suave | `#0f2a24` | `bg-brand-soft`, `bg-success-subtle` | Fondo de éxito |
| success | `#3dd68c` | `success`, `success-foreground` | Estado |
| warning | `#f5b544` · fondo `#2a2010` | `warning*` | Estado |
| error | `#ff6b6f` · texto `#ff8a8d` · fondo `#2e1517` | `destructive*` (relleno con tinta oscura) | Estado (7.0 · 6.5 · 5.9) |
| info | `#7fb0ff` · fondo `#12203a` | `info*` | Estado, tags |
| neutral | `#a2aaa7` · texto `#cfd6d3` · fondo `#1c2120` | `neutral*` | Estado inerte |
| coral de resalte | `#ff7a4d` + tinta oscura | `highlight*` | Badge "nuevo" |
| píldora sobre hero | `#ffffff` · tinta `#0a0a0a` | `bg-on-hero`, `text-on-hero-foreground` | Botón `translucent` sobre `.hero-dark` (igual en claro) |

La jerarquía es binaria: `foreground` o `muted-foreground`. La profundidad
se marca subiendo de superficie (canvas → card → secondary) y con hairline,
no con sombra ni con opacidad sobre texto.

Estados (success/warning/info/neutral/destructive): cada uno tiene
`--<tono>` (punto/ícono/texto suelto), `--<tono>-subtle` (tinte) y
`--<tono>-foreground` (texto sobre surface-2 o sobre su tinte). `StatusBadge`
es una píldora sobre `neutral-subtle` + hairline con punto y texto de color:
el estado es señal, no relleno.

#### Bandas hero (degradados)

| Clase / utilidad | Degradado | Texto |
| --- | --- | --- |
| `.hero-dark` / `bg-hero-dark` | 135° `#0a2b26` → `#0d4a3f` 50% → `#0e6453` | Blanco (peor punto 7.1:1); secundario `text-white/85` (5.6:1) |
| `.hero-sky` / `bg-hero-sky` | 180° `#dbeeff` → `#fff6ea` | Ink `#0f1211` (15.9:1), incluso en modo oscuro |

Son la **única** superficie con degradado: panel de marca del login, cifra
protagonista de Panorama, total de la cotización pública. Una por pantalla,
nunca fondo de sección, radio `rounded-spotlight` (16px). Botones encima:
`variant="translucent"` (píldora blanca `on-hero`). Las clases
`.spotlight-*` y `bg-gradient-*` de la familia anterior siguen existiendo como
alias de `hero-dark` mientras se migran; no las uses en código nuevo.

#### Contraste verificado (WCAG 2.2)

Calculado por `scripts/contrast-audit.mjs` a partir de `globals.css`
(90 pares por modo; el script falla si algo baja de AA). Texto ≥4.5:1;
componentes de UI (foco, borde de control, puntos) ≥3:1.

| Par | Oscuro | Claro |
| --- | --- | --- |
| Texto / canvas · surface-1 · surface-2 · hover | 18.3 · 16.9 · 15.4 · 13.8 | 18.8 · 17.4 · 15.8 · 15.0 |
| Muted / canvas · surface-1 · surface-2 · hover | 8.2 · 7.5 · 6.9 · 6.2 | 6.3 · 5.8 · 5.3 · 5.0 |
| Enlace / foco (`primary`) / canvas · surface-1 · surface-2 | 11.5 · 10.6 · 9.7 | 6.5 · 6.0 · 5.4 |
| Tinta / píldora primaria · hover · activo | 19.4 · 15.9 · 13.5 | 18.8 · 13.6 · 9.7 |
| Tinta / menta (`accent`) | 10.1 | 9.8 |
| Borde de control / canvas · surface-1 · surface-2 | 4.3 · 3.9 · 3.6 | 3.9 · 3.6 · 3.3 |
| Destructivo texto / canvas · surface-1 · surface-2 · tinta sobre relleno | 7.0 · 6.5 · 5.9 · 7.0 | 5.6 · 5.1 · 4.7 · 5.6 |
| `text-success` / `text-warning` / `text-info` sobre canvas | 10.3 / 10.7 / 8.8 | 5.4 / 5.6 / 5.9 |
| Insignias `StatusBadge` sobre `neutral-subtle` (éxito / aviso / info / neutral / destr.) | 8.7 / 9.0 / 7.4 / 11.0 / 7.2 | 6.2 / 6.4 / 6.7 / 8.5 / 6.0 |
| Botón deshabilitado: muted / `primary-disabled` | 5.8 | 5.0 |
| Texto de estado sobre su tinte `*-subtle` | ≥7.4 | ≥5.9 |
| Punto de estado sobre su tinte | ≥6.1 | ≥4.8 |
| Coral de resalte con tinta ink | 7.5 | 6.6 |
| Blanco / blanco 85% sobre `.hero-dark` (peor punto) | 7.1 / 5.6 | 7.1 / 5.6 |

### Tipografía

- **Inter** para todo: cuerpo, UI y titulares (peso 600). `font-display` se
  conserva como alias de Inter para no tocar usos. Variantes
  `cv01 cv05 cv09 cv11 ss03 ss07` siempre activas (en `body`); tablas,
  `.tabular-nums` y `[data-money]` agregan `tnum`.
- **Geist Mono** (`font-mono`): código, ids, SKUs, firmas. Nunca prosa.
- Sin itálicas: el énfasis es peso 500/600, color o fondo.
- Cuerpo **16px / 1.5 / tracking 0** (el `body` ya lo trae). Nunca interlínea
  <1.5 en 14–16px. Display: tracking negativo suave, interlínea ≥1.05.

**Una sola escala** (`tailwind.config.ts` → `fontSize`). El portal operativo
usa siete peldaños y nada fuera de ellos; los `display-*` son solo para
páginas públicas (login, cotización pública, checkout, seguimiento).

| Token | Tamaño | Peso | Interlínea | Tracking | Uso |
| --- | --- | --- | --- | --- | --- |
| `text-h1` | 24→28px | 600 | 1.20 | -0.015em | h1 de pantalla (`PageHeader`). Uno por pantalla. |
| `text-h2` | 18px | 600 | 1.40 | -0.01em | Título de `Section`, `CardTitle`, `SheetTitle`, `AlertDialogTitle`, `EmptyState` |
| `text-h3` | 16px | 600 | 1.50 | 0 | Sub-bloque dentro de una sección, título de tarjeta chica |
| `text-body` | 16px | 400 | 1.50 | 0 | Prosa, descripción bajo el h1, páginas de ayuda |
| `text-body-sm` | 14px | 400 | 1.50 | 0 | **Tamaño de UI por defecto**: nav del sidebar, celdas, inputs, botones, menús, etiquetas, descripciones de sección |
| `text-body-sm-medium` | 14px | 500 | 1.50 | 0 | Nav activa, etiqueta de pestaña, rótulo del topbar |
| `text-caption` | 13px | 400 | 1.40 | 0 | Ayuda y error bajo un campo, pista de `StatTile`, tooltip, migas, cabecera de tabla (uppercase), `Badge` default |
| `text-micro` | 12px | 500 | 1.40 | 0 | Chips `size="sm"`, contadores, marcas de tiempo en burbujas. Mínimo para texto corrido. |
| `text-micro-uppercase` | 11px | 600 | 1.40 | +0.5px | Rótulos de grupo (sidebar, `DropdownMenuLabel`), "REQUERIDO". Nunca prosa. |
| `text-code-md` / `text-code-sm` | 14 / 13px | 400 | 1.5 / 1.4 | 0 | Código, ids, SKUs (`font-mono`) |
| `text-display-md/lg/xl/xxl` | 26→72px | 600 | 1.05–1.2 | negativo | Solo páginas públicas y bandas hero |

Alias históricos (`text-headline` 22, `text-subhead` 18/400, `text-body-lg`)
siguen existiendo; en código nuevo usa h1/h2/h3.

**`text-xs`/`text-sm`/`text-base`/`text-lg` están remapeados a la escala**:
`text-xs` = caption (13px, ya no 12), `text-sm` = body-sm, `text-base` =
body, `text-lg` = 18px. Así los cientos de usos previos caen en un peldaño
real sin reescribirlos, pero en código nuevo escribe el nombre semántico.
Prohibido `text-[11px]`, `text-[10px]` y similares fuera de ejes de gráficas.

Jerarquía por pantalla, de arriba abajo: h1 (28) → descripción (16) →
h2 de sección (18) → descripción de sección / celdas / campos (14) → ayuda,
error, cabecera de tabla (13) → chips (12) → rótulos de grupo (11). Si una
pantalla necesita más de estos peldaños, el problema es la pantalla.

Chrome: el sidebar va en **body-sm 400** (steel) y solo la entrada activa en
500 con tinta plena; los títulos de grupo en micro-uppercase; el nombre de
la empresa en body-sm 600. Es el mismo 14px de las tablas: la barra no puede
verse más grande que el contenido.

h1 → `PageHeader` (`text-h1`). h2 → `Section` (`text-h2`). Un solo `<h1>`
por pantalla. Ids/SKUs → `font-mono text-code-sm`.

### Espaciado, radios y elevación

- Espaciado base 4px (incremento principal 8): 4 · 8 · 12 · 16 · 20 · 24 ·
  32 · 40, secciones 48 / 64 / 96 (`p-section`). Entre secciones `space-y-6`;
  dentro `space-y-4`. Tarjeta: padding 24 (compacta) / 32 (panel).
- Radios: `rounded-xs` 4 (chips de código) · `rounded-sm` 6 (ítems de nav,
  insignias) · `rounded-md` 8 (inputs, búsqueda, código, ghost) ·
  `rounded-lg` / `rounded-card` 12 (tarjetas, FAQ) · `rounded-xl` /
  `rounded-spotlight` 16 (paneles grandes, hero) · `rounded-2xl` 24
  (vitrinas) · `rounded-full` / `rounded-pill` (TODO botón de texto, avatares).
- Elevación: **0 plano con hairline por defecto** (tarjetas, filas, inputs) ·
  `shadow-1` tile al hover · `shadow-2` (alias `shadow-airbnb`) menús y
  tooltips · `shadow-3` (alias `shadow-airbnb-lg`) diálogos y sheets ·
  `shadow-brand` tarjeta destacada (borde menta 2px + halo) ·
  `shadow-selected` anillo menta 2px (foco / seleccionado).

### Responsive

Cortes Tailwind: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280. Móvil primero:
una columna, tiles 2-up desde 480, grillas de 2 desde `md`, 3 desde `lg`.
Canal lateral 16px en teléfono, sin scroll horizontal de página
(`html { overflow-x: clip }`); tablas con scroll interno. Botones, inputs,
ítems de nav y botones de ícono miden **44px** en móvil y se compactan a
40 / 36 desde `sm`. Verificar en 360×740, 390×844, 768, 1024 y 1280.

### Hacer / no hacer

Hacer: píldora en todo botón de texto (negra en claro, blanca en oscuro);
menta solo en `accent`, checks, borde destacado, foco y enlaces; subir de
superficie o hairline para jerarquía; degradados solo en `.hero-*`;
`rounded-lg` en tarjetas, `rounded-md` en UI compacta; cuerpo 16/1.5;
Inter + Geist Mono, nada más; 44px de tacto en móvil.

No hacer: menta en texto de cuerpo o en fondos grandes; otros acentos fuera
de menta, tag-blue, error y coral de resalte; sombras en tarjetas planas;
interlínea <1.5 en cuerpo; dos acentos compitiendo en un hero; Inter para
código o Geist Mono para prosa; hex crudo en TSX; botones cuadrados.

---

## 2. Primitivas — `@/components/ui`

### `Button`

```ts
variant: "default" | "cta" | "accent" | "secondary" | "outline" | "ghost" | "destructive" | "destructive-solid" | "warning" | "translucent" | "link"
size:    "sm" | "default" | "lg" | "icon"
loading?: boolean   // muestra Spinner, aplica aria-busy y disabled
asChild?: boolean   // con asChild, `loading` se ignora
```

```tsx
<Button loading={m.isPending}>Guardar</Button>
<Button variant="accent">Emitir cotización</Button>
<Button variant="outline" size="sm" asChild><Link href="/orders">Ver pedidos</Link></Button>
<Button variant="ghost" size="icon" aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
```

- `default`/`cta`: píldora dominante (negra en claro, blanca en oscuro). La acción principal.
- `accent`: píldora **menta** con tinta ink. Solo el CTA de máxima intención (emitir, cobrar, entrar): uno por pantalla.
- `secondary`/`outline`: píldora con borde hairline y tinta ink; hover sube a surface-2. Rinden igual.
- `ghost`: sin relleno ni borde, `rounded-md` (el único botón que no es píldora).
- `destructive`/`warning`: píldora con borde y texto de estado; hover en su tinte `*-subtle`. `destructive-solid`: relleno rojo, solo para confirmar algo irreversible.
- `translucent`: píldora blanca `on-hero` sobre `.hero-dark`.
- `link`: texto en `legal-link` subrayado al hover.
- Alturas móvil → `sm`: `default` 44 → 40 · `sm` 44 → 36 · `lg` 48 · `icon` 44 → 36 (círculo).
- Presionado = `scale(0.97)` + un paso de tono. Foco = anillo menta 2px con separación (`ring-offset-2`).
- **Deshabilitado**: nunca opacidad. Las variantes con relleno pasan a fondo
  hairline (`primary-disabled`) + texto `muted-foreground` (5.0:1 claro,
  5.8:1 oscuro); las sin relleno (`secondary`/`outline`/`ghost`/`link`/
  `destructive`/`warning`) solo bajan el texto a `muted-soft`. Un botón en
  `loading` conserva su color (variante Tailwind `inactive:` =
  `:disabled:not([aria-busy])`).
- **Botones de ícono** (contraer barra, menú de usuario, cerrar sheet, acciones
  de fila): siempre `rounded-full` (`size="icon"` ya lo trae). La única
  excepción son los **ítems de lista de nav** (sidebar, drawer), que son
  filas, no botones: `rounded-sm` con 44px de alto en móvil.

`loading` **no** cambia el texto: si quieres "Guardando…" ponlo tú como children.

### `Input` · `Textarea` · `Select` · `Checkbox` · `Label`

Mismo alto (**44px móvil, 40 desde `sm`**: `h-11 sm:h-10`, igual que
`Button` default), padding 14px, fondo (`bg-background`, el lienzo), radio
`rounded-md` (8px), texto (16px móvil / body-sm desde `sm`) y foco. Todo
sale de `fieldClassName` (`ui/input.tsx`): `Input`, `Textarea` y `Select`
comparten el contrato entero, incluido el deshabilitado (relleno `muted`,
texto `muted-foreground`, borde hairline; **sin opacidad**). Para error pasa
`aria-invalid` y el borde rojo sale solo. `Select` es un `<select>` nativo
estilizado (sin Radix, sin dependencia nueva); `Checkbox` es un
`<input type="checkbox">` con `accent-primary` (20px en móvil, 16 desde `sm`).

Un campo se compone siempre igual: `Label` (body-sm 500) → control →
ayuda/error en **`text-caption`** (13px), ayuda en `muted-foreground`, error
en `destructive`, ambos enlazados por `aria-describedby`. Alturas distintas
solo en búsquedas dentro de menús o barras de tabla (`h-9` / `h-8`).

**Placeholders**: son un *ejemplo*, no la etiqueta repetida ni una orden.
Formato `Ej. …` (con punto y sin dos puntos), español neutro, sin datos de
negocio reales. `Label="Nombre del producto"` → `placeholder="Ej. Playera
de algodón unisex"`; `Label="RFC"` → `placeholder="Ej. XAXX010101000"`;
búsquedas → `"Buscar por nombre o SKU…"`. Contraste del placeholder
(`muted-foreground` sobre lienzo): 6.3:1 claro, 8.2:1 oscuro, par
"placeholder de campo" del `contrast-audit`.

El borde en reposo de los cuatro es `border-input` (≥3.3:1 contra canvas,
surface-1 y surface-2 en ambos modos: `#6e7875` oscuro, `#7a827f` claro): el
relleno del campo es el lienzo, así que el borde es el control. No lo cambies
por `border-border` — ese es el separador estructural (hairline) y no llega a
3:1. Foco = borde + anillo de 1px en `ring` (menta profunda). La palomita y
el punto del radio usan `accent-primary` (menta profunda: 6.5:1 claro /
11.5:1 oscuro, objeto gráfico bajo 1.4.11). Los campos tienen 16px en móvil
para evitar el zoom de iOS.

```tsx
<div className="space-y-1.5">
  <Label htmlFor="sku">SKU</Label>
  <Input id="sku" placeholder="Ej. PLAY-ALG-M-AZUL" aria-invalid={!!errors.sku}
    aria-describedby={errors.sku ? "sku-error" : "sku-hint"} {...register("sku")} />
  {errors.sku
    ? <p id="sku-error" className="text-caption text-destructive">{errors.sku.message}</p>
    : <p id="sku-hint" className="text-caption text-muted-foreground">Único por producto.</p>}
</div>

<Select id="estado" value={status} onChange={(e) => setStatus(e.target.value)}>
  <option value="">Todos los estados</option>
  <option value="ACTIVE">Activo</option>
</Select>

<div className="flex items-center gap-2">
  <Checkbox id="emitir" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
  <Label htmlFor="emitir">Emitir al guardar</Label>
</div>
```

### `RadioGroup` · `Radio` · `RadioCard`

```ts
function RadioGroup(props: {
  legend: ReactNode;             // <legend> del <fieldset>
  description?: ReactNode;       // enlazado con aria-describedby
  name?: string;                 // heredado por los hijos
  hideLegend?: boolean;
  orientation?: "vertical" | "horizontal";   // default "vertical"
  optionsClassName?: string;
} & Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "children">): JSX.Element

function Radio(props: { label?: ReactNode }
  & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">): JSX.Element

function RadioCard(props: { label: ReactNode; description?: ReactNode }
  & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">): JSX.Element
```

`<input type="radio">` nativo, deliberadamente. Un grupo de radios nativos con
el mismo `name` ya da **un solo tab stop para el grupo y flechas para moverse
entre opciones**, más `aria-checked` implícito. **Nunca pongas `tabIndex`** en
un `Radio`/`RadioCard`: es la forma clásica de romper eso.

`RadioCard` es el caso "elige uno de tres, cada uno con su explicación". El
resalte de la opción activa (borde `primary` + fondo `brand-soft`) sale de
`has-[:checked]:` en CSS, así que funciona igual controlado o no controlado;
el anillo de foco va en la tarjeta completa (`focus-within`), no en el punto.

```tsx
<RadioGroup legend="Estilo de venta" name="sales_style"
  description="Define el tono del agente al responder.">
  <RadioCard value="consultivo" label="Consultivo"
    description="Pregunta antes de recomendar."
    checked={style === "consultivo"} onChange={() => set("consultivo")} />
  <RadioCard value="directo" label="Directo"
    description="Va al grano con una recomendación."
    checked={style === "directo"} onChange={() => set("directo")} />
</RadioGroup>

<RadioGroup legend="Entrega" name="delivery" orientation="horizontal">
  <Radio value="PICKUP" label="Recolección" defaultChecked />
  <Radio value="LOCAL_DELIVERY" label="Envío local" />
</RadioGroup>
```

### `Card`

`Card` (con `asChild?`) · `CardHeader` · `CardTitle` · `CardDescription` ·
`CardContent` · `CardFooter`. Plana: surface-1, hairline, `rounded-lg`
(12px), **sin sombra**. Para bloques de pantalla usa `Section`, que ya los
compone.

### `Tabs`

```ts
Tabs:        { defaultValue; value?; onValueChange?; variant?: "underline" | "pill" }
TabsList:    React.HTMLAttributes<HTMLDivElement>   // role="tablist", flechas ← →
TabsTrigger: { value }
TabsContent: { value }
```

`underline` (por defecto): lista con hairline inferior; inactivo
`muted-foreground`, activo `foreground` + subrayado de 2px en ink. `pill`: la
lista es una píldora sobre surface-1 y el activo sube a surface-2. Alto táctil
44px en móvil, 36 desde `sm`.

```tsx
<Tabs defaultValue="pagos">
  <TabsList aria-label="Secciones">
    <TabsTrigger value="pagos">Pagos</TabsTrigger>
    <TabsTrigger value="ledger">Movimientos</TabsTrigger>
  </TabsList>
  <TabsContent value="pagos">…</TabsContent>
</Tabs>
```

### `Table`

Cabecera `text-caption` (13px) 500 `muted-foreground` en mayúsculas; celdas
`text-body-sm` (14px); ids/SKUs `font-mono text-code-sm`; chips en la fila
`size="sm"` (micro). Filas con `hairline-soft`, hover `bg-muted`,
seleccionada `bg-secondary`. El contenedor lleva
`.scroll-x-shadow`: en móvil una sombra en el borde avisa que hay más
columnas y desaparece al final del scroll (si la tabla va sobre canvas y no
sobre una tarjeta, pásale `containerClassName="[--scroll-shadow-bg:var(--background)]"`).
`stickyFirstColumn` fija la columna identificadora (folio, SKU, cliente).

```ts
Table:      { stickyHeader?: boolean; stickyFirstColumn?: boolean; containerClassName?: string }
TableHead:  { numeric?: boolean }   // + scope="col" por defecto
TableCell:  { numeric?: boolean }   // text-right + tabular-nums
TableRow:   { interactive?: boolean }
// + TableHeader, TableBody, TableFooter, TableCaption
```

```tsx
<Table stickyHeader containerClassName="max-h-[60vh]">
  <TableHeader><TableRow interactive={false}>
    <TableHead>SKU</TableHead><TableHead numeric>Total</TableHead>
  </TableRow></TableHeader>
  <TableBody><TableRow>
    <TableCell className="font-mono text-xs">ABC-1</TableCell>
    <TableCell numeric><Money value="1240.00" /></TableCell>
  </TableRow></TableBody>
</Table>
```

### `StatusBadge`

Ver §4 para el catálogo completo de estados.

### `Alert`

```ts
variant: "default" | "success" | "warning" | "info" | "destructive"
// las variantes distintas de default llevan role="alert"
```

```tsx
<Alert variant="destructive">
  <AlertCircle />
  <AlertTitle>No se pudo guardar</AlertTitle>
  <AlertDescription>Revisa los campos marcados.</AlertDescription>
</Alert>
```

El ícono va como primer hijo; el layout ya le reserva el hueco. Cada
variante = tinte `*-subtle` + texto `*-foreground` + borde del tono al 30%;
`default` es surface-1 con hairline.

### `AlertDialog` (confirmaciones) · `Sheet` (paneles)

```ts
// alert-dialog.tsx
function AlertDialogAction(props: {
  variant?: "default" | "destructive";   // default "destructive"
  loading?: boolean;                     // Spinner + aria-busy + disabled
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element

// sheet.tsx
function SheetContent(props: {
  side?: "top" | "right" | "bottom" | "left";   // default "right"
  title?: ReactNode;                            // default "Panel"
} & React.ComponentPropsWithoutRef<typeof Dialog.Content>): JSX.Element
```

Comportamiento del `AlertDialog`, ya resuelto en la primitiva:

- **Escape cierra el diálogo** y eso equivale a *cancelar* (pasa por
  `onOpenChange(false)`, nunca por `onConfirm`). Bloquear Escape dejaba
  "Cancelar" como única salida: keyboard trap, WCAG 2.1.2.
- **El clic fuera sigue bloqueado** a propósito: confirma acciones destructivas
  (reembolsos, cancelaciones, archivar) y un clic perdido no debe descartarlo.
- **`aria-describedby` se anula solo** cuando no rindes `AlertDialogDescription`.
  No hace falta el parche `{...(description ? {} : { "aria-describedby": undefined })}`
  en el consumidor.
- `AlertDialogAction` es un `Button` de verdad: hereda `loading`. No inlines un
  `<Spinner>` a mano.

```tsx
<AlertDialogAction loading={mutation.isPending} onClick={onConfirm}>
  Archivar
</AlertDialogAction>
```

El panel del `Sheet` lleva `border-hairline-strong` en el lado de apertura y
`shadow-3`; el cierre es un botón de ícono de 44px (36 desde `sm`).

`SheetContent` **no puede quedarse sin nombre accesible**: si no rindes un
`SheetTitle` visible, se rinde un título `sr-only` con `title` (por defecto
"Panel"). Radix lanza cuando falta el título; esto lo hace imposible por olvido.
Si rindes tu propio `SheetTitle`, ese gana y el respaldo se retira.

```tsx
{/* con título visible: title no hace falta */}
<SheetContent><SheetHeader><SheetTitle>Nuevo producto</SheetTitle></SheetHeader>…</SheetContent>

{/* sin título visible (nav móvil): el nombre va por `title` */}
<SheetContent side="left" title="Navegación principal">…</SheetContent>
```

### `EmptyState`

```ts
{ icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }
```

```tsx
<EmptyState icon={<PackageOpen className="h-6 w-6" />} title="Sin pedidos"
  description="Cuando entre la primera venta la verás aquí."
  action={<Button onClick={onNew}>Nuevo pedido</Button>} />
```

### `Skeleton` · `SkeletonText` · `SkeletonTable` · `SkeletonRegion`

```ts
Skeleton:        React.HTMLAttributes<HTMLDivElement>          // siempre aria-hidden
SkeletonText:    { lines?: number; announce?: boolean; label?: string }
SkeletonTable:   { rows?: number; cols?: number; header?: boolean;
                   announce?: boolean; label?: string }
SkeletonRegion:  { label?: string }   // role="status" aria-live="polite"
```

**`SkeletonText` y `SkeletonTable` son mudos por defecto** (`announce: false`):
son bloques visuales, `aria-hidden`. El que habla es `SkeletonRegion`.

Regla: **una sola región viva por pantalla.** Si tres bloques cargan a la vez y
cada uno anuncia, el lector dice "Cargando" tres veces y no se entiende qué está
cargando. Envuelve el área, no cada bloque.

```tsx
// varios bloques, un solo anuncio
<SkeletonRegion label="Cargando el cobro…">
  <SkeletonText lines={2} />
  <SkeletonTable rows={3} cols={3} />
</SkeletonRegion>

// bloque único en la pantalla: puede anunciar solo
<SkeletonText lines={2} announce label="Cargando el resumen…" />
```

Si usas `DataTable` no necesitas nada de esto: ya trae su propia región.

### `Spinner`

```tsx
<Spinner />                       // anuncia "Cargando…"
<Spinner size="sm" label={null} /> // dentro de un contenedor que ya anuncia
```

### `Tooltip`

`TooltipProvider` · `Tooltip` · `TooltipTrigger` · `TooltipContent`. En
pantallas táctiles (`pointer: coarse`) el tooltip se fuerza cerrado: sin hover
no hay forma de descartarlo y se quedaba pegado en el drawer móvil. El
trigger debe llevar su propio nombre accesible (`aria-label`); el tooltip solo
lo repite para ratón y teclado.

### `Badge`

Etiqueta genérica (conteos, tags). Para estados de dominio usa `StatusBadge`.

```ts
variant: "default" | "secondary" | "outline" | "success" | "warning" | "info"
       | "neutral" | "muted" | "destructive" | "destructive-solid" | "highlight" | "brand"
size:    "sm" | "default"     // idénticos a StatusBadge
```

Los tonos de estado van sobre su tinte `*-subtle` con `*-foreground` (≥5.9:1
claro, ≥7.4:1 oscuro). `Badge` es rectangular (`rounded-sm`); `StatusBadge`
es píldora (`rounded-full`) sobre `neutral-subtle` + hairline, para que un
tenant que tiñe `secondary` no le cambie el color. `size="default"` es
caption (13px) y `size="sm"` micro (12px) en ambos: nada por debajo. `brand` = menta con tinta ink (descuentos, "gratis");
`highlight` = coral con tinta ink ("nuevo", "recomendado"). Nunca texto
blanco sobre menta ni sobre coral.

`size` usa exactamente las mismas medidas que `StatusBadge`, así que un chip y
una insignia de estado en la misma fila quedan alineados.

```tsx
<Badge variant="neutral" size="sm">WHATSAPP</Badge>
<StatusBadge status={c.status} domain="connection" size="sm" />
```

---

## 3. Composites — `@/components/app`

### `DataTable<T>` — el componente de TODA pantalla de listado

```ts
interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  numeric?: boolean;      // text-right + tabular-nums
  width?: string;         // "8rem", "15%"
  className?: string;     // clases de celda (no de encabezado)
  cell: (row: T) => ReactNode;
}

interface DataTableEmpty {
  icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode;
}

function DataTable<T>(props: {
  columns: Array<DataTableColumn<T>>;
  rows: T[] | undefined;
  empty: DataTableEmpty;                       // obligatorio
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  getRowId?: (row: T, index: number) => string;      // default: row.id ?? index
  getRowHref?: (row: T) => string | undefined;       // fila navegable (<Link>)
  onRowClick?: (row: T) => void;                     // fila interactiva (<button>)
  getRowActionLabel?: (row: T) => string;            // nombre accesible del control
  getRowClassName?: (row: T) => string | undefined;
  caption?: ReactNode;
  visibleCaption?: boolean;                          // default false (sr-only)
  stickyHeader?: boolean;
  skeletonRows?: number;                             // default 5
  className?: string;
  containerClassName?: string;
}): JSX.Element
```

Resuelve los cuatro estados de la query en un solo lugar. Precedencia:
**error > cargando > vacío > datos**.

```tsx
const q = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });

const columns: Array<DataTableColumn<Order>> = [
  { key: "id", header: "ID", width: "8rem",
    cell: (o) => <span className="font-mono text-xs">{o.id.slice(0, 8)}…</span> },
  { key: "customer", header: "Cliente", cell: (o) => o.customer.fullName },
  { key: "status", header: "Estado",
    cell: (o) => <StatusBadge status={o.status} domain="order" /> },
  { key: "total", header: "Total", numeric: true,
    cell: (o) => <Money value={o.total} /> },
  { key: "paidAt", header: "Pagado",
    cell: (o) => <DateTime value={o.paidAt} className="text-muted-foreground" /> },
];

<Section title="Pedidos" padded={false}>
  <DataTable
    columns={columns}
    rows={q.data}
    isLoading={q.isLoading}
    isError={q.isError}
    error={q.error}
    onRetry={() => void q.refetch()}
    getRowHref={(o) => `/orders/${o.id}`}
    caption="Pedidos del comercio"
    empty={{ icon: <PackageOpen className="h-6 w-6" />, title: "Sin pedidos",
             description: "Cuando entre la primera venta la verás aquí." }}
  />
</Section>
```

**Filas interactivas — dos modos, nunca los dos a la vez:**

| Necesitas | Prop | Qué rinde |
| --- | --- | --- |
| navegar a una ruta | `getRowHref` | `<Link>` real en la primera celda |
| abrir un Sheet, seleccionar, expandir | `onRowClick` | `<button>` real en la primera celda |

En ambos casos la fila entera es clicable **y** el elemento enfocable es un
control nativo: teclado (Enter/Espacio), foco visible y lectores de pantalla
funcionan sin inventar `role` en el `<tr>`. Con `getRowHref` además funciona
"abrir en pestaña nueva". Los clics sobre `a/button/input/select/textarea`
dentro de la fila no disparan la acción de fila, así que puedes meter una
columna de acciones sin conflicto.

**Si pasas ambos, gana `getRowHref`** — una ruta es enlazable y compartible, un
handler no. Usa `onRowClick` solo cuando no exista ruta para ese detalle.

`getRowActionLabel` es opcional: sin él, el contenido de la primera celda nombra
el control (el SKU, el folio), que suele ser lo correcto. Pásalo cuando esa
celda no sea un nombre útil.

```tsx
// Catálogo: no hay /catalog/[id], el detalle es un Sheet.
<DataTable
  columns={columns}
  rows={list.data}
  onRowClick={(p) => setEditingId(p.id)}
  getRowActionLabel={(p) => `Editar ${p.sku}`}
  empty={{ title: "No hay productos todavía." }}
/>
```

### `Section`

```ts
function Section(props: {
  title?: ReactNode;
  headerIcon?: ReactNode;            // hermano del <h2>, aria-hidden
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;                  // default true; false para tablas
  density?: "default" | "compact";   // default "default"
  as?: "h2" | "h3" | "h4";           // default "h2"
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">): JSX.Element
```

```tsx
<Section title="Totales" description="Incluye IVA.">…</Section>
<Section title="Pagos" padded={false} actions={<Button size="sm">Cobrar</Button>}>
  <DataTable … />
</Section>
<Section title="Canales" headerIcon={<MessageCircle className="h-4 w-4" />}>…</Section>
```

`density` controla el padding interno: `default` = `p-4 sm:p-6` (cuerpo
principal), `compact` = `p-3` (columnas estrechas y barras laterales de ~20rem,
donde `sm:p-6` se come el ancho útil). **Usa `density="compact"` en vez de pisar
el padding con `contentClassName`.**

**No metas el ícono dentro de `title`.** `title={<span className="flex …"><Icon/>
Canales</span>}` mete markup decorativo dentro del `<h2>` y ensucia el nombre
accesible de la sección. Para eso está `headerIcon`, que lo rinde como hermano
del encabezado y `aria-hidden`.

### `DescriptionList` · `FieldRow`

```ts
function DescriptionList(props: { divided?: boolean }
  & React.HTMLAttributes<HTMLDListElement>): JSX.Element   // <dl>

function FieldRow(props: {
  label: ReactNode;
  children?: ReactNode;   // vacío/null → em dash + "Sin dato" para lectores
  mono?: boolean;         // ids, SKUs
  numeric?: boolean;      // derecha + tabular-nums
  emphasis?: boolean;     // renglón de total
  hint?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">): JSX.Element
```

Apilado en móvil, dos columnas desde `sm`.

```tsx
<Section title="Cliente">
  <DescriptionList divided>
    <FieldRow label="Nombre">{order.customer.fullName}</FieldRow>
    <FieldRow label="RFC" mono>{order.customer.taxId}</FieldRow>
    <FieldRow label="Total" numeric emphasis><Money value={order.total} /></FieldRow>
  </DescriptionList>
</Section>
```

### `PageHeader`

```ts
interface Breadcrumb { label: string; href?: string }

function PageHeader(props: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];     // <nav aria-label="Ruta">
  backHref?: string;
  backLabel?: string;             // default "Volver"
  meta?: ReactNode;               // fila bajo el encabezado
  className?: string;
}): JSX.Element
```

Las props anteriores (`title`, `description`, `actions`, `className`) siguen
funcionando igual; lo demás es opcional.

```tsx
<PageHeader
  title={`Venta ${order.id.slice(0, 8)}…`}
  backHref="/orders"
  breadcrumbs={[{ label: "Pedidos", href: "/orders" }, { label: "Detalle" }]}
  meta={<StatusBadge status={order.status} domain="order" />}
/>
```

### `Money` · `formatMoney`

```ts
type MoneyValue = string | number | null | undefined;   // el API manda string

const DEFAULT_CURRENCY = "MXN";
function formatMoney(value: MoneyValue, currency?: string | null): string;
function resolveCurrency(currency: string | null | undefined): string;

function Money(props: {
  value: MoneyValue;
  currency?: string | null; // default "MXN"
  showCurrency?: boolean;   // "$1,234.50 MXN"
  emphasis?: boolean;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">): JSX.Element
```

`Intl.NumberFormat("es-MX")`, `tabular-nums`, negativos en `text-destructive`,
em dash cuando no hay dato. Los importes llegan como `string` decimal porque en
el backend son `Decimal(12,2)`: **no** los pases por `Number()` antes.

**Moneda inválida: nunca revienta.** `Intl.NumberFormat` lanza `RangeError` con
cualquier código que no sea ISO 4217 (`""`, `"MX"`, `"PESOS"`, `"XX!"`), y un
solo registro corrupto tumbaría la pantalla completa. `formatMoney` valida el
código y cae a `MXN`, **siempre pintando el importe**:

| `currency` | resultado |
| --- | --- |
| `"MXN"` / `"mxn"` / `undefined` / `null` | `"$1,234.50"` |
| `"USD"` (válido, no default) | `"USD 1,234.50"` |
| `"XX!"`, `"PESOS"`, `"MX"`, `""` | `"$1,234.50"` (cae a MXN) |

Con `showCurrency` se etiqueta con la moneda **efectiva** (`resolveCurrency`), no
con la que pidió el llamador: poner "XX!" junto a un importe formateado en pesos
sería mentir sobre el dato. Puedes pasar `session.currency` del API tal cual.

```tsx
<TableCell numeric><Money value={s.amount} currency={s.currency} /></TableCell>
formatMoney("1234.5")   // "$1,234.50"
```

### `DateTime` · `formatDateTime` · `formatDate`

```ts
type DateValue = string | number | Date | null | undefined;

function formatDate(value: DateValue): string;         // "08 sept 2026"
function formatDateTime(value: DateValue): string;     // "08 sept 2026, 14:32"
function formatDateTimeLong(value: DateValue): string; // completo, con zona

function DateTime(props: {
  value: DateValue;
  withTime?: boolean;   // default true
} & Omit<React.TimeHTMLAttributes<HTMLTimeElement>, "dateTime">): JSX.Element
```

Rinde `<time dateTime={iso} title={timestamp completo}>`. Zona fija
`America/Mexico_City`: todo el equipo lee el mismo reloj y no hay error de
hidratación entre servidor y navegador.

**Fecha inválida o ausente → em dash**, nunca el literal `"Invalid Date"`.
Cubre `null`, `undefined`, `""`, un string basura (`"garbage"`, `"2026-13-45"`),
`NaN` y un objeto `Date` inválido. El `<time>` no se rinde en ese caso: sale un
`—` visual más un "Sin fecha" para lectores de pantalla.

```tsx
<DateTime value={order.createdAt} />
<DateTime value={order.paidAt} withTime={false} className="text-muted-foreground" />
```

### `StatTile`

```ts
function StatTile(props: {
  label: ReactNode;      // arriba del valor, text-xs muted
  value: ReactNode;      // número grande, tabular-nums; acepta <Money>
  hint?: ReactNode;      // línea de contexto bajo el valor
  icon?: ReactNode;      // chip a la derecha, aria-hidden
  tone?: Tone;           // default "neutral" (tinta normal)
  isLoading?: boolean;   // skeleton del alto exacto del valor
  isError?: boolean;     // "No se pudo cargar" + Reintentar
  onRetry?: () => void;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">): JSX.Element
```

Resuelve los estados de query igual que `DataTable` — precedencia **error >
cargando > dato** (si un refetch falla no se vuelve al skeleton, que se leería
como "sigue cargando"). La etiqueta se ve en los tres estados, así que el
mosaico nunca pierde su identidad. El skeleton del valor va en `h-8`, la caja de
línea exacta de `text-2xl`: **la rejilla de KPIs no reflowea al cargar**.

Un KPI no tiene estado "vacío": cero es un dato. Lo que cambia entonces es la
pista, y eso lo decide el llamador.

Orden fijo **etiqueta → valor → pista**: la etiqueta va arriba, en el DOM y
visualmente, para que el número nunca llegue sin contexto a un lector de
pantalla. El valor no es un encabezado (son datos, no estructura): si necesitas
agrupar varios mosaicos, envuélvelos en una `Section` con título.

```tsx
<div className="grid gap-4 sm:grid-cols-3">
  <StatTile label="Cobrado hoy" value={<Money value={stats.captured} />}
    tone="success" icon={<TrendingUp className="h-4 w-4" />} hint="12 sesiones"
    isLoading={q.isLoading} isError={q.isError} onRetry={() => void q.refetch()} />
  <StatTile label="Pendientes" value={stats.pending} tone="warning" />
  <StatTile label="Ticket promedio" value={<Money value={stats.avg} />} />
</div>
```

### `EntityId`

```ts
function EntityId(props: {
  value: string;         // id completo
  length?: number;       // default 8, caracteres visibles
  copyable?: boolean;    // default true
  copyLabel?: string;    // default "Copiar id" (nombre accesible del botón)
  toastLabel?: string;   // default "ID" (texto del toast)
  className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">): JSX.Element
```

Sustituye a `<span className="font-mono text-xs">{id.slice(0, 8)}…</span>` y a
las copias a mano del botón de copiar. Rinde el token truncado en monoespaciada,
el valor completo en `title`, **y también en un `sr-only`** para que un lector de
pantalla anuncie el id entero y no "abc123 puntos suspensivos".

El botón es un `<button type="button">` con `aria-label`, alcanzable por teclado
y con anillo de foco visible. Usa `navigator.clipboard` con toast de `sonner`;
si la API no existe (contexto http, permiso denegado) no revienta: muestra el
valor en un toast para copiarlo a mano. `stopPropagation`, así que funciona
dentro de una fila navegable de `DataTable` sin dispararla.

```tsx
<EntityId value={order.id} />
<EntityId value={session.id} length={12} copyable={false} />
<TableCell><EntityId value={payment.id} toastLabel="ID de pago" /></TableCell>
```

---

## 4. Estados de dominio — `StatusBadge`

```ts
type Tone = "success" | "warning" | "info" | "neutral" | "destructive";

type StatusDomain =
  | "order" | "payment" | "quote" | "catalog" | "customer" | "membership"
  | "tenant" | "revision" | "ledger" | "channel" | "notification"
  | "conversation" | "message" | "integration" | "connection" | "job"
  | "outbox" | "role" | "generic";

function statusTone(status: string, domain?: StatusDomain): Tone;    // fallback "neutral"
function statusLabel(status: string, domain?: StatusDomain): string; // fallback: el string crudo

function StatusBadge(props: {
  status: string;              // valor del enum EN MAYÚSCULAS, tal cual del API
  domain?: StatusDomain;       // default "generic"
  tone?: Tone;                 // escape hatch
  label?: string;              // escape hatch
  size?: "sm" | "default";
  withDot?: boolean;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">): JSX.Element
```

```tsx
<StatusBadge status={order.status} domain="order" />
<StatusBadge status={payment.status} domain="payment" withDot />
```

**Pasa siempre `domain`.** Varios enums de Prisma comparten valores con matices
distintos (`ACCEPTED`, `CANCELLED`, `EXPIRED`, `ACTIVE`, `PENDING`, `OPEN`,
`REFUNDED`); sin `domain` se usa el mapa compartido, correcto para el caso común
pero no para todos.

Fuente de verdad de los valores: `apps/commerce-api/prisma/schema.prisma`.
Registros exportados desde `@/components/ui/status-badge`:

| Export | Enum |
| --- | --- |
| `ORDER_STATUS_LABELS` | OrderStatus |
| `PAYMENT_STATUS_LABELS` | PaymentStatus |
| `QUOTE_STATUS_LABELS` | QuoteStatus |
| `CATALOG_STATUS_LABELS` | CatalogStatus |
| `CUSTOMER_STATUS_LABELS` | CustomerStatus |
| `MEMBERSHIP_STATUS_LABELS` | MembershipStatus |
| `TENANT_STATUS_LABELS` | TenantStatus |
| `REVISION_STATUS_LABELS` | RevisionStatus |
| `LEDGER_TYPE_LABELS` | LedgerEntryType |
| `SOURCE_LABELS` | OrderSource |
| `ROLE_LABELS` | Role |
| `CHANNEL_LABELS` | Channel / WhatsAppProvider |
| `DELIVERY_MODE_LABELS` | DeliveryMode |
| `CONSENT_SCOPE_LABELS` | ConsentScope |
| `NOTIFICATION_STATUS_LABELS` | NotificationStatus / Channel / Recipient |
| `CONVERSATION_STATUS_LABELS` | ConversationStatus |
| `MESSAGE_STATUS_LABELS` | MessageStatus / Direction / Type |
| `INTEGRATION_STATUS_LABELS` | IntegrationStatus / EventStatus / Direction / WhatsAppStatus |
| `CONNECTION_STATUS_LABELS` | `Connection.status` (canal de WhatsApp vivo) |
| `JOB_STATUS_LABELS` | JobStatus |
| `OUTBOX_STATUS_LABELS` | OutboxStatus / InboxStatus |
| `STATUS_LABELS` | mapa compartido (todos los anteriores) |

Etiquetas clave: `PAID`→"Pagado" · `AWAITING_PAYMENT`→"Por pagar" ·
`CHECKOUT_OPEN`→"Checkout abierto" · `CAPTURED`→"Cobrado" ·
`PARTIALLY_REFUNDED`→"Reembolso parcial" · `ISSUED`→"Emitida" ·
`FULFILLED`→"Entregado" · `QUICK_CHARGE`→"Cobro rápido".

Criterio de tono: `success` terminó bien · `warning` espera acción humana ·
`info` en curso / informativo · `destructive` falló o murió · `neutral` inerte o
desconocido. Un `REFUNDED` en `order`/`payment` es `warning`, no `success`.

Un valor desconocido **no rompe**: tono `neutral` y se muestra el string crudo.

### `domain="connection"` — canales de WhatsApp

Un canal conectado no es una "integración activa": se habla de conectado /
desconectado. `CONNECTION_STATUS_LABELS` queda **fuera** del mapa compartido a
propósito (ahí `ACTIVE` = "Conectado", que sería incorrecto para el resto de la
app), así que este dominio es de uso explícito.

| valor | etiqueta | tono |
| --- | --- | --- |
| `ACTIVE` | Conectado | `success` |
| `PENDING` | Esperando confirmación | `warning` |
| `ERROR` | Con error | `destructive` |
| `DISCONNECTED` | Desconectado | `neutral` |

```tsx
<StatusBadge status={connection.status} domain="connection" />
```

`DISCONNECTED: "Desconectado"` también se agregó a `INTEGRATION_STATUS_LABELS`
(y por tanto al mapa compartido), donde antes caía al enum crudo.

---

## 5. Migración desde el código actual

| Hoy | Ahora |
| --- | --- |
| `<table className="w-full text-sm">…` | `DataTable` (listados) o `Table` (a medida) |
| `` `$${o.total}` `` | `<Money value={o.total} />` |
| `new Date(x).toLocaleString("es-MX")` | `<DateTime value={x} />` |
| `<Badge variant={statusVariant(s)}>{s}</Badge>` | `<StatusBadge status={s} domain="order" />` |
| `<div className="rounded-card border bg-card p-4">` | `<Section title="…">` |
| `<select className="flex h-11 w-full rounded-md border …">` | `<Select>` |
| `<Loader2 className="h-4 w-4 animate-spin" />` en botón | `<Button loading>` |
| `bg-emerald-50`, `bg-amber-100`, `dark:bg-*` | `bg-success-subtle`, `bg-warning-subtle` |
| `<td colSpan={7}>Cargando…</td>` / `Sin pedidos.` | los resuelve `DataTable` |

`src/lib/payments.ts` (`money`, `statusVariant`, `ORDER_STATUS_LABEL`,
`PAYMENT_STATUS_LABEL`, `LEDGER_TYPE_LABEL`) queda **deprecado**: sus
consumidores siguen compilando, pero al tocar una pantalla migra a `Money` y
`StatusBadge`. Se borra cuando no queden call sites.
