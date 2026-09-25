# Sistema de diseño — Atiende ya (portal operativo)

Referencia de la capa de primitivas. Todo lo de aquí ya existe y compila: no
reimplementes nada, no copies clases de una pantalla a otra.

- Identidad: **Arcade** — canvas indigo profundo (`canvas` `#0a091a`, sin light
  mode), acorde de tres acentos de marca: `primary` indigo-violeta (dos
  niveles: `#5d52e0` ornamento · `#776cef` texto/relleno), `cta` verde
  eléctrico (`#44e499`, la acción de MAYOR intención — una por pantalla) y
  `highlight` magenta (`#ee63bb` texto · `#dc1895` relleno, solo insignias y
  resaltados, nunca botones). Tipografía display (Space Grotesk 600/700) en
  h1/h2, `font-sans` (Inter) en todo lo demás. Radios 12px (controles) / 20px
  (tarjetas). Fuente del tema: `src/app/globals.css` + `tailwind.config.ts` —
  cada hex de ahí viene de una fórmula de contraste WCAG real, no a ojo; si
  cambias un HSL, recalcula el contraste antes de subirlo.
- Idioma de UI: **es-MX**. Todo texto visible en español.
- Dueño de esta capa: Design System Lead. Si te falta una prop, **pídela**; no
  hagas un fork del componente en tu pantalla.

---

## 0. Reglas no negociables

1. **Nunca un hex crudo.** `#10b981`, `bg-emerald-100`, `bg-amber-50` están
   prohibidos. Solo tokens: `bg-success-subtle`, `text-warning-foreground`, …
2. **Nunca un `<table>` a pelo.** Listados → `DataTable`. Tablas a medida →
   `Table`/`TableRow`/`TableCell` de `@/components/ui/table`.
3. **Nunca `toLocaleString()` / `toLocaleDateString()` en línea.** Fechas →
   `DateTime` / `formatDateTime`. Importes → `Money` / `formatMoney`.
4. **Nunca un `<div className="rounded-card border bg-card p-4">`.** Eso es
   `Section` (o `Card` si de verdad no lleva encabezado).
5. **Nunca el enum crudo en pantalla.** `DRAFT` no, "Borrador" sí →
   `StatusBadge` / `statusLabel`.
6. **Todo elemento interactivo** necesita anillo de foco visible y nombre
   accesible. Un botón que solo tiene ícono lleva `aria-label`. Un `Input` o
   `Select` lleva `<Label htmlFor>` o `aria-label`.

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

### Tipografía

| Rol | Clases |
| --- | --- |
| h1 (título de página) | `text-2xl font-semibold tracking-tight` (lo pone `PageHeader`) |
| h2 (título de sección) | `text-base font-semibold` (lo pone `Section`) |
| cuerpo | `text-sm` |
| meta / secundario | `text-xs text-muted-foreground` |
| ids, SKUs, tokens | `font-mono text-xs` |
| importes y conteos | `tabular-nums` (lo ponen `Money` y `numeric`) |

Un solo `<h1>` por pantalla. `Section` rinde `<h2>`; si anidas, pasa `as="h3"`.

### Color

| Token | Uso |
| --- | --- |
| `primary` | acento de marca **ornamento**: íconos, bordes de selección, rieles, `accent-color`, tintes. Nunca texto encima, nunca como tinta |
| `primary-strong` (+ `-hover`, `-active`) | acento de marca **texto y relleno**: todo lo que renderiza texto sobre el acento o usa el acento como tinta |
| `cta` (+ `-hover`, `-active`) | acento de **mayor intención** (verde): la acción con la que de verdad se quiere que el usuario salga de la pantalla. Una por pantalla, nunca decoración |
| `highlight` / `highlight-strong` | acento de **resalte** (magenta): insignias, "nuevo", categoría destacada. Nunca botones de acción, nunca comunica estado |
| `primary-disabled` | relleno de control inhabilitado (exento de contraste) |
| `foreground` `body-text` `muted-foreground` | tinta |
| `canvas` `background` `card` `muted` `secondary` `popover` | superficies (todas oscuras — sin light mode) |
| `input` | **límite de control**: borde de `Input`/`Select`/`Textarea`/`Checkbox`/`RadioCard` |
| `border` / `hairline` `hairline-soft` `hairline-strong` | separadores estructurales y hairlines decorativas |
| `success` `warning` `info` `neutral` `destructive` | **solo estado**, nunca decoración |

#### El acento de marca tiene dos niveles — y en oscuro el porqué cambia

En un canvas claro, "texto del acento sobre el canvas" y "texto claro sobre
el acento como relleno" mejoran con el MISMO cambio (más oscuro). Sobre un
canvas oscuro dejan de tirar en la misma dirección: un violeta más claro
mejora su lectura como texto-sobre-negro pero empeora la de un texto blanco
encima suyo (el relleno se acerca al blanco). La solución: el relleno lleva
SIEMPRE tinta oscura (`primary-foreground`, casi negro), nunca blanca — así
"más claro" vuelve a mejorar los dos contrastes a la vez. Mismo patrón en
`cta` y en el relleno sólido de `destructive`.

| Si el acento… | usa | mide |
| --- | --- | --- |
| lleva texto encima (`Button` default, `Badge` default) | `bg-primary-strong` + `text-primary-foreground` | 4.85:1 |
| **es** la tinta (`Button` link, `text-…`) | `text-primary-strong` | 4.85:1 sobre `canvas` |
| es adorno: ícono, riel, borde de opción marcada, `accent-color` | `primary` | 3.51:1 ✓ 1.4.11 |

Rampa del nivel fuerte — mismo tono 245° y misma saturación, solo cambia la
luminosidad. En oscuro el hover/activo ACLARA (al revés que en un sistema
claro: sobre canvas negro, más claro = más énfasis):

| estado | token | hex | contraste |
| --- | --- | --- | --- |
| reposo | `primary-strong` | `#776cef` | 4.85:1 sobre `canvas` y con `primary-foreground` |
| hover | `primary-strong-hover` | `#9088f2` | 6.55:1 |
| activo | `primary-strong-active` | `#a29af4` | 7.93:1 |

Los tres son sólidos, **no** `bg-primary/90`: el alfa sobre un canvas oscuro
mueve el contraste de forma impredecible según lo que haya debajo.
`primary-active` sigue existiendo como alias de `primary-strong-active` para
call sites viejos; no lo uses en código nuevo.

`cta` (verde, `#44e499`, 12.00:1 sobre `canvas`) y `highlight` (magenta,
ornamento/texto `#ee63bb` 6.69:1 · relleno `highlight-strong` `#dc1895` con
tinta BLANCA 4.56:1 — este relleno sí es lo bastante oscuro) siguen la misma
lógica de niveles. `highlight-strong` es la única excepción con tinta blanca
en el relleno: es notablemente más oscuro que `primary-strong`/`cta`.

#### Las líneas tienen tres papeles

WCAG 1.4.11 exige 3:1 solo a los límites que son la **única** forma de
identificar un control. No a toda hairline. Por eso hay un token que pasa y dos
que a propósito no:

| Token | Papel | Contraste | ¿3:1? |
| --- | --- | --- | --- |
| `input` `#5c5f84` | **límite de control**: el campo es `bg-background` sobre canvas del mismo tono, el borde es lo único que lo delimita | 3.21:1 sobre `canvas` | **sí, obligatorio** |
| `border` / `hairline` `#2d2d43` | **separador estructural**: canto de `Card`, reglas de `Table`, `Separator`, capas flotantes, `Badge outline` | 1.47:1 | no aplica |
| `hairline-soft` `#232337` | **hairline decorativa**: `divide-hairline-soft` entre pares etiqueta/valor | aún más tenue | no aplica |
| `hairline-strong` | **relleno**, no borde: solo `active:bg-hairline-strong/40` | — | no aplica |

Los estructurales se quedan tenues a propósito: la tarjeta ya se separa por el
resplandor violeta y el padding, las filas por posición y contenido, el badge
por su propio texto. Subirlos a 3:1 dibujaría una retícula sobre toda la app
sin resolver ninguna barrera real. **Si un control nuevo necesita borde, es
`border-input`, nunca `border-border`.**

Cada tono semántico tiene tres slots:

- `--<tono>` → sólido (`bg-success`), para íconos, puntos y bordes.
- `--<tono>-subtle` → tinte de fondo (`bg-success-subtle`).
- `--<tono>-foreground` → tinta sobre ese tinte (`text-success-foreground`).

Contraste tinta/tinte verificado (WCAG 2.1) sobre el canvas oscuro: success
9.54:1 · warning 9.27:1 · info 8.96:1 · neutral 8.74:1 · destructive 7.70:1.
Todos AA y AAA.

**Excepción:** `--destructive-foreground` es tinta OSCURA (no blanca — ver
"por qué cambia" arriba) porque además es relleno sólido de `Button`/`Badge`
(`variant="destructive"`). La tinta sobre el tinte rojo es
`text-destructive-subtle-foreground`. El `:active` del botón destructivo usa
`destructive-active` (`#f3a198`, más claro, mismo patrón "aclarar = énfasis"
en oscuro) y no `bg-destructive/80`.

#### Exento de contraste, dicho en voz alta

- `primary-disabled` y `muted-soft` no cumplen 4.5:1 **y no tienen que
  hacerlo**: WCAG 2.1 exime explícitamente a los componentes inhabilitados de
  1.4.3 y 1.4.11. El estado tampoco depende solo del color — los primitivos
  ponen `disabled:opacity-50` y el atributo `disabled`.
- `legal-link` es `#47bef5` (9.33:1 sobre `canvas`).

Anillo de foco: `ring-foreground` (`#f5f7f9`) da 18.33:1 contra el canvas
oscuro. `ring-offset-background` intercala 2px del color de fondo entre el
anillo y el relleno.

### Sombras y radios

- En oscuro una sombra negra no se ve: `shadow-airbnb` y `shadow-airbnb-lg`
  son un resplandor violeta muy sutil (tono de `primary`) + un borde de 1px
  casi invisible. `shadow-airbnb` → superficies en reposo. `shadow-airbnb-lg`
  → capas flotantes (dialog, sheet, dropdown, tooltip). No hay una tercera.
- `rounded-lg` (12px) botones e inputs · `rounded-card` (20px) tarjetas ·
  `rounded-pill` insignias.
- `font-display` (Space Grotesk 600/700) en h1 (`PageHeader`) y h2 (`Section`)
  únicamente. Todo lo demás — cuerpo, tablas, controles — se queda en
  `font-sans` (Inter): el salto de peso es la voz del sistema, no algo para
  párrafos densos.

---

## 2. Primitivas — `@/components/ui`

### `Button`

```ts
variant: "default" | "secondary" | "outline" | "ghost" | "destructive" | "warning" | "link" | "cta"
size:    "sm" | "default" | "lg" | "icon"
loading?: boolean   // muestra Spinner, aplica aria-busy y disabled
asChild?: boolean   // con asChild, `loading` se ignora
```

```tsx
<Button loading={m.isPending}>Guardar</Button>
<Button variant="outline" size="sm" asChild><Link href="/orders">Ver pedidos</Link></Button>
<Button variant="ghost" size="icon" aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
```

`loading` **no** cambia el texto: si quieres "Guardando…" ponlo tú como children.

### `Input` · `Textarea` · `Select` · `Checkbox` · `Label`

Mismo alto (`h-10`), radio y foco. Para error pasa `aria-invalid` y el borde rojo
sale solo. `Select` es un `<select>` nativo estilizado (sin Radix, sin dependencia
nueva); `Checkbox` es un `<input type="checkbox">` con `accent-primary`.

El borde en reposo de los cuatro es `border-input` (`#8a8a8a`, 3.45:1): son
campos blancos sobre página blanca, así que el borde es el control. No lo
cambies por `border-border` — ese es el separador estructural y vive en 1.35:1.
La palomita y el punto del radio siguen en `accent-primary` a propósito: son
objeto gráfico, les aplica 1.4.11 (3:1) y #ff3859 da 3.52:1.

```tsx
<div className="space-y-1.5">
  <Label htmlFor="sku">SKU</Label>
  <Input id="sku" aria-invalid={!!errors.sku} {...register("sku")} />
  {errors.sku && <p className="text-xs text-destructive">{errors.sku.message}</p>}
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
resalte de la opción activa sale de `has-[:checked]:` en CSS, así que funciona
igual controlado o no controlado; el anillo de foco va en la tarjeta completa
(`focus-within`), no en el punto de 16px.

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
`CardContent` · `CardFooter`. Para bloques de pantalla usa `Section`, que ya los
compone.

### `Table`

```ts
Table:      { stickyHeader?: boolean; containerClassName?: string }
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

El ícono va como primer hijo; el layout ya le reserva el hueco.

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

### `Badge`

Etiqueta genérica (conteos, tags). Para estados de dominio usa `StatusBadge`.

```ts
variant: "default" | "secondary" | "outline" | "success" | "warning" | "info"
       | "neutral" | "muted" | "destructive" | "destructive-solid" | "highlight"
size:    "sm" | "default"     // idénticos a StatusBadge
```

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
| `<select className="flex h-10 w-full rounded-lg border …">` | `<Select>` |
| `<Loader2 className="h-4 w-4 animate-spin" />` en botón | `<Button loading>` |
| `bg-emerald-50`, `bg-amber-100`, `dark:bg-*` | `bg-success-subtle`, `bg-warning-subtle` |
| `<td colSpan={7}>Cargando…</td>` / `Sin pedidos.` | los resuelve `DataTable` |

`src/lib/payments.ts` (`money`, `statusVariant`, `ORDER_STATUS_LABEL`,
`PAYMENT_STATUS_LABEL`, `LEDGER_TYPE_LABEL`) queda **deprecado**: sus
consumidores siguen compilando, pero al tocar una pantalla migra a `Money` y
`StatusBadge`. Se borra cuando no queden call sites.
