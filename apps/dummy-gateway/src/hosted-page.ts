/**
 * Plantillas HTML de la página hosted del gateway dummy.
 *
 * Todo va inline (CSS en <style>, JS vanilla en <script>): la página se sirve
 * bajo un CSP sin orígenes externos y no hay paso de build. La estética imita
 * a Stripe Checkout: dos columnas en escritorio (resumen a la izquierda,
 * formulario a la derecha), una en móvil, paleta neutra y bordes suaves.
 *
 * Nada de lo que se escribe aquí mueve dinero real: livemode es siempre false
 * y la cabecera "Modo de prueba" lo recuerda en todas las pantallas.
 */
import {
  PAYMENT_METHODS,
  type InternalSession,
  type PaymentMethod,
  type SessionLineItem,
} from "./checkout.store.js";

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "1234.5" → "$1,234.50". Sin Number(): se separa la parte entera como texto. */
export function formatMoney(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const trimmed = String(amount).trim();
  const negative = trimmed.startsWith("-");
  const [intRaw = "", decRaw = ""] = trimmed.replace(/^-/, "").split(".");
  if (!/^\d+$/.test(intRaw)) return trimmed;
  const int = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = (decRaw + "00").slice(0, 2);
  return `${negative ? "-" : ""}$${int}.${dec}`;
}

/** "2.000" → "2"; "1.500" → "1.5". Las cantidades vienen como Decimal(18,3). */
function formatQuantity(quantity: string): string {
  if (!/^\d+(\.\d+)?$/.test(quantity)) return quantity;
  return quantity.replace(/\.?0+$/, "");
}

function lineTotal(item: SessionLineItem): string | null {
  if (item.unitPrice == null) return null;
  const price = Number(item.unitPrice);
  const qty = Number(item.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
  return (Math.round(price * qty * 100) / 100).toFixed(2);
}

function formatDate(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(date);
}

const BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  unknown: "Tarjeta",
};

/** Serializa para incrustar en <script> sin permitir cerrar la etiqueta. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---------------------------------------------------------------------------
// piezas compartidas
// ---------------------------------------------------------------------------

const BASE_CSS = `
  :root{
    color-scheme:light;
    --bg:#ffffff;--bg-muted:#f6f8fa;--text:#1a1f36;--text-2:#697386;--text-3:#8792a2;
    --border:#e3e8ee;--border-strong:#c9d0d9;--primary:#0f172a;--primary-hover:#1e293b;
    --focus:rgba(15,23,42,.18);--danger:#df1b41;--danger-bg:#fff5f7;--success:#1f8a4c;--success-bg:#ecfdf3;
    --warn-bg:#fff7e6;--warn-text:#8a5a00;--warn-border:#f5d78e;--radius:8px;
    --shadow:0 1px 3px rgba(26,31,54,.06),0 6px 20px rgba(26,31,54,.06);
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif;
    font-size:15px;line-height:1.45;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .banner{position:sticky;top:0;z-index:5;background:var(--warn-bg);color:var(--warn-text);border-bottom:1px solid var(--warn-border);
    font-size:13px;padding:.55rem 1rem;display:flex;flex-wrap:wrap;gap:.35rem 1.25rem;align-items:center;justify-content:center;text-align:center}
  .banner strong{font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11.5px}
  .banner code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:rgba(0,0,0,.05);padding:.05rem .35rem;border-radius:4px}
  .lock{display:inline-flex;align-items:center;gap:.35rem;color:var(--text-3);font-size:12.5px}
  .lock svg{width:12px;height:12px}
  .powered{color:var(--text-3);font-size:12.5px;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
  .powered b{color:var(--text-2);font-weight:600}
  .powered .sep{width:1px;height:12px;background:var(--border-strong)}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.8rem 1rem;border-radius:var(--radius);
    border:1px solid transparent;font:inherit;font-weight:600;font-size:15.5px;cursor:pointer;text-decoration:none;transition:background .15s,box-shadow .15s}
  .btn-primary{background:var(--primary);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .btn-primary:hover{background:var(--primary-hover)}
  .btn-primary:disabled{opacity:.6;cursor:progress}
  .btn-secondary{background:#fff;color:var(--text);border-color:var(--border-strong)}
  .btn-secondary:hover{background:var(--bg-muted)}
  .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite;display:none}
  .btn.loading .spinner{display:inline-block}
  @keyframes spin{to{transform:rotate(360deg)}}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  @media(max-width:600px){.banner{gap:.2rem .75rem;font-size:12.5px}.banner .extra{display:none}}
`;

function testModeBanner(): string {
  return `<div class="banner" role="status">
    <strong>Modo de prueba</strong>
    <span class="extra">Ninguna tarjeta real se cobra.</span>
    <span>Aprobada: <code>4242 4242 4242 4242</code> <span class="extra">(cualquier número válido)</span></span>
    <span>Rechazada: <code>4000 0000 0000 0002</code></span>
    <span class="extra">SPEI y OXXO se confirman con un botón, sin banco de por medio.</span>
  </div>`;
}

const LOCK_SVG = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.4"/></svg>`;

function poweredBy(): string {
  return `<div class="powered">
    <span class="lock">${LOCK_SVG} Pago seguro</span>
    <span class="sep"></span>
    <span>Con tecnología de <b>Easy Sell</b> by Tupla</span>
    <span class="sep"></span>
    <span>Sandbox · sin dinero real</span>
  </div>`;
}

function lineItemsHtml(items: SessionLineItem[] | undefined, compact = false): string {
  if (!items || items.length === 0) return "";
  const rows = items
    .map((item) => {
      const qty = formatQuantity(item.quantity);
      const unit = item.unitPrice != null ? formatMoney(item.unitPrice) : null;
      const total = lineTotal(item);
      return `<li class="item">
        <div class="item-main">
          <span class="item-title">${escapeHtml(item.title)}</span>
          <span class="item-meta">${escapeHtml(qty)} × ${unit ? escapeHtml(unit) : "—"}</span>
        </div>
        <span class="item-total">${total ? escapeHtml(formatMoney(total)) : ""}</span>
      </li>`;
    })
    .join("");
  return `<ul class="items${compact ? " compact" : ""}">${rows}</ul>`;
}

function totalsHtml(session: InternalSession): string {
  const t = session.totals ?? {};
  const rows: string[] = [];
  const push = (label: string, value: string | undefined, cls = "") => {
    if (value == null || value === "") return;
    rows.push(`<div class="trow ${cls}"><dt>${label}</dt><dd>${escapeHtml(formatMoney(value))}</dd></div>`);
  };
  push("Subtotal", t.subtotal);
  if (t.discount && Number(t.discount) > 0) push("Descuento", `-${t.discount}`);
  push("IVA", t.tax);
  push("Envío", t.shipping);
  const grand = t.total ?? session.amount;
  rows.push(
    `<div class="trow grand"><dt>Total a pagar</dt><dd>${escapeHtml(formatMoney(grand))} <span class="cur">${escapeHtml(session.currency)}</span></dd></div>`,
  );
  return `<dl class="totals">${rows.join("")}</dl>`;
}

// ---------------------------------------------------------------------------
// pantalla de pago
// ---------------------------------------------------------------------------

const CHECKOUT_CSS = `
  .layout{display:grid;grid-template-columns:1fr;min-height:calc(100vh - 41px)}
  .summary{background:var(--bg-muted);padding:1.5rem 1.25rem 1rem}
  .checkout{padding:1.5rem 1.25rem 3rem;background:var(--bg)}
  .col{max-width:420px;margin:0 auto;width:100%}
  @media(min-width:900px){
    .layout{grid-template-columns:1fr 1fr}
    .summary{padding:3rem 3rem 2rem;border-right:1px solid var(--border);display:flex;flex-direction:column}
    .summary .col{margin:0 0 0 auto;padding-right:1rem}
    .checkout{padding:3rem 3rem 3rem}
    .checkout .col{margin:0 auto 0 0;padding-left:1rem}
    .summary .powered{margin-top:auto;padding-top:2rem}
  }
  .back{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;color:var(--text-2);font-size:14px;font-weight:500;margin-bottom:1.25rem}
  .back svg{width:14px;height:14px}
  .merchant{display:flex;align-items:center;gap:.6rem;margin-bottom:1.5rem}
  .merchant-mark{width:28px;height:28px;border-radius:7px;background:var(--primary);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none}
  .merchant-name{font-weight:600;font-size:15px}
  .pay-to{margin:0;color:var(--text-2);font-size:15px;font-weight:500}
  .total-big{margin:.15rem 0 1.75rem;font-size:36px;font-weight:600;letter-spacing:-.02em;line-height:1.1}
  .total-big .cur{font-size:15px;font-weight:500;color:var(--text-2);margin-left:.35rem;letter-spacing:0}
  .items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.9rem}
  .item{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}
  .item-main{display:flex;flex-direction:column;gap:.1rem;min-width:0}
  .item-title{font-weight:500;font-size:14.5px;overflow-wrap:anywhere}
  .item-meta{color:var(--text-2);font-size:13px}
  .item-total{font-weight:500;font-size:14.5px;white-space:nowrap}
  .totals{margin:1.25rem 0 0;padding-top:1rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.5rem}
  .trow{display:flex;justify-content:space-between;font-size:14px;color:var(--text-2)}
  .trow dt,.trow dd{margin:0}
  .trow.grand{padding-top:.75rem;margin-top:.25rem;border-top:1px solid var(--border);color:var(--text);font-weight:600;font-size:15px}
  .trow .cur{font-weight:500;color:var(--text-2);font-size:13px}
  .summary .powered{margin-top:2rem}
  .checkout h2{font-size:17px;font-weight:600;margin:0 0 1.15rem}
  .methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:.5rem;margin-bottom:1.15rem}
  .method{border:1px solid var(--border-strong);border-radius:var(--radius);background:#fff;padding:.65rem .4rem;font:inherit;font-size:13px;
    font-weight:500;color:var(--text-2);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:.35rem;transition:border-color .15s,box-shadow .15s}
  .method:hover{background:var(--bg-muted)}
  .method[aria-selected="true"]{border-color:var(--primary);color:var(--text);box-shadow:0 0 0 1px var(--primary)}
  .method svg{width:22px;height:22px}
  .panel[hidden]{display:none}
  .ref-box{border:1px dashed var(--border-strong);border-radius:var(--radius);background:var(--bg-muted);padding:.9rem 1rem;margin-bottom:1rem}
  .ref-box dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.45rem 1rem;font-size:14px;align-items:baseline}
  .ref-box dt{color:var(--text-2);margin:0}
  .ref-box dd{margin:0;font-weight:600;overflow-wrap:anywhere}
  .ref-box dd.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}
  .ref-note{color:var(--text-2);font-size:13px;margin:.75rem 0 0;line-height:1.45}
  .field{margin-bottom:1rem}
  .field label,.legend{display:block;font-size:13.5px;font-weight:500;color:var(--text-2);margin-bottom:.35rem}
  .control{width:100%;padding:.62rem .75rem;border:1px solid var(--border-strong);border-radius:var(--radius);font:inherit;font-size:15px;color:var(--text);
    background:#fff;outline:none;box-shadow:0 1px 1px rgba(0,0,0,.03);transition:border-color .15s,box-shadow .15s;appearance:none;-webkit-appearance:none}
  .control::placeholder{color:#a3acb9}
  .control:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--focus)}
  .control[aria-invalid="true"]{border-color:var(--danger);box-shadow:0 0 0 3px rgba(223,27,65,.12)}
  select.control{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' fill='none' stroke='%23697386' stroke-width='1.5'/%3E%3C/svg%3E");
    background-repeat:no-repeat;background-position:right .75rem center;padding-right:2rem}
  .group{border:1px solid var(--border-strong);border-radius:var(--radius);box-shadow:0 1px 1px rgba(0,0,0,.03);overflow:hidden;background:#fff}
  .group .control{border:0;border-radius:0;box-shadow:none}
  .group .control:focus{box-shadow:inset 0 0 0 2px var(--primary)}
  .group .control[aria-invalid="true"]{box-shadow:inset 0 0 0 2px var(--danger)}
  .group-row{display:flex;border-top:1px solid var(--border-strong)}
  .group-row .control:first-child{border-right:1px solid var(--border-strong)}
  .card-number{position:relative}
  .card-number .control{padding-right:3.25rem}
  .brand{position:absolute;right:.65rem;top:50%;transform:translateY(-50%);display:flex;align-items:center;pointer-events:none}
  .brand svg{width:32px;height:20px;display:none}
  .brand[data-brand="visa"] .b-visa,.brand[data-brand="mastercard"] .b-mc,.brand[data-brand="amex"] .b-amex,.brand[data-brand="unknown"] .b-generic{display:block}
  .error{display:none;color:var(--danger);font-size:13px;margin-top:.35rem}
  .error.show{display:block}
  .billing{margin:1.25rem 0 1.25rem;border:1px solid var(--border);border-radius:var(--radius);background:#fff}
  .billing-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem .9rem}
  .billing-head h3{margin:0;font-size:14.5px;font-weight:600}
  .billing-head p{margin:.1rem 0 0;color:var(--text-2);font-size:13px}
  .toggle{display:flex;align-items:center;gap:.5rem;font-size:13.5px;color:var(--text-2);cursor:pointer;user-select:none;white-space:nowrap}
  .toggle input{width:16px;height:16px;margin:0;accent-color:var(--primary)}
  .badge-req{font-size:11.5px;font-weight:600;color:var(--warn-text);background:var(--warn-bg);border:1px solid var(--warn-border);padding:.1rem .45rem;border-radius:999px;white-space:nowrap}
  .billing-body{padding:0 .9rem .9rem;border-top:1px solid var(--border)}
  .billing-body[hidden]{display:none}
  .billing-body .field:first-child{margin-top:.9rem}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  @media(max-width:420px){.row2{grid-template-columns:1fr}}
  .form-error{display:none;background:var(--danger-bg);color:var(--danger);border:1px solid #f7c7d1;border-radius:var(--radius);padding:.7rem .85rem;font-size:13.5px;margin-bottom:1rem}
  .form-error.show{display:block}
  .terms{color:var(--text-3);font-size:12.5px;margin:1rem 0 0;text-align:center}
  .checkout .powered{margin-top:2rem;justify-content:center}
`;

const CARD_BRAND_SVGS = `
  <svg class="b-visa" viewBox="0 0 32 20" aria-label="Visa"><rect width="32" height="20" rx="3" fill="#1a1f71"/><text x="16" y="14" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-style="italic" font-size="10" fill="#fff">VISA</text></svg>
  <svg class="b-mc" viewBox="0 0 32 20" aria-label="Mastercard"><rect width="32" height="20" rx="3" fill="#252525"/><circle cx="13" cy="10" r="5.5" fill="#eb001b"/><circle cx="19" cy="10" r="5.5" fill="#f79e1b" fill-opacity=".9"/></svg>
  <svg class="b-amex" viewBox="0 0 32 20" aria-label="American Express"><rect width="32" height="20" rx="3" fill="#2e77bc"/><text x="16" y="13.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="7" fill="#fff">AMEX</text></svg>
  <svg class="b-generic" viewBox="0 0 32 20" aria-hidden="true"><rect x=".5" y=".5" width="31" height="19" rx="3" fill="#fff" stroke="#c9d0d9"/><rect x="3" y="5" width="26" height="3" fill="#c9d0d9"/><rect x="3" y="11" width="10" height="2" fill="#e3e8ee"/></svg>
`;

const COUNTRIES: Array<[string, string]> = [
  ["MX", "México"],
  ["US", "Estados Unidos"],
  ["CA", "Canadá"],
  ["ES", "España"],
  ["AR", "Argentina"],
  ["BR", "Brasil"],
  ["CL", "Chile"],
  ["CO", "Colombia"],
  ["CR", "Costa Rica"],
  ["GT", "Guatemala"],
  ["PE", "Perú"],
  ["UY", "Uruguay"],
];

function countryOptions(): string {
  return COUNTRIES.map(([code, name]) => `<option value="${code}"${code === "MX" ? " selected" : ""}>${name}</option>`).join("");
}

/** JS del formulario. String.raw para no tener que escapar cada barra invertida. */
const CHECKOUT_JS = String.raw`
(function () {
  var S = window.__SESSION__;
  var $ = function (id) { return document.getElementById(id); };
  // La página puede servirse detrás de un proxy con prefijo (p. ej.
  // https://tienda.example/pay/checkout/<id>/hosted). Todas las llamadas al
  // gateway se arman relativas a ese prefijo para que funcionen igual con o
  // sin él; nunca con rutas absolutas desde la raíz del dominio.
  var BASE = window.location.pathname.replace(/\/checkout\/[^/]+\/hosted\/?$/, '');
  var form = $('payForm');
  var email = $('email'), number = $('cardNumber'), expiry = $('cardExpiry'), cvc = $('cardCvc');
  var holder = $('cardName'), country = $('country'), brandEl = $('brand');
  var payBtn = $('payBtn'), formError = $('formError');
  var method = S.paymentMethods[0] || 'CARD';

  // ---- método de pago -------------------------------------------------------
  var methodButtons = Array.prototype.slice.call(document.querySelectorAll('.method[data-method]'));
  function selectMethod(next) {
    method = next;
    methodButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-method') === next;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
    });
    ['CARD', 'SPEI', 'OXXO'].forEach(function (m) {
      var panel = $('panel' + m);
      if (panel) panel.hidden = m !== next;
    });
    $('payLabel').textContent = S.payLabels[next] || S.payLabels.CARD;
    hideFormError();
  }
  methodButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { selectMethod(btn.getAttribute('data-method')); });
  });
  selectMethod(method);
  var sameToggle = $('sameAsHolder'), billingBody = $('billingBody');
  var b = {
    name: $('bName'), rfc: $('bRfc'), street: $('bStreet'), neighborhood: $('bNeighborhood'),
    city: $('bCity'), state: $('bState'), postalCode: $('bPostalCode'), country: $('bCountry')
  };

  // ---- tarjeta ------------------------------------------------------------
  function detectBrand(digits) {
    if (/^3[47]/.test(digits)) return 'amex';
    if (/^4/.test(digits)) return 'visa';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
    return 'unknown';
  }
  function maxLen(brand) { return brand === 'amex' ? 15 : 16; }
  function groupDigits(digits, brand) {
    if (brand === 'amex') {
      return digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*$/, function (_, a, c, d) {
        return [a, c, d].filter(Boolean).join(' ');
      });
    }
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  function luhn(digits) {
    var sum = 0, dbl = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = digits.charCodeAt(i) - 48;
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n; dbl = !dbl;
    }
    return digits.length > 0 && sum % 10 === 0;
  }
  function cardDigits() { return number.value.replace(/\D/g, ''); }

  number.addEventListener('input', function () {
    var digits = cardDigits();
    var brand = detectBrand(digits);
    digits = digits.slice(0, maxLen(brand));
    number.value = groupDigits(digits, brand);
    brandEl.setAttribute('data-brand', brand);
    cvc.setAttribute('maxlength', brand === 'amex' ? '4' : '3');
    cvc.placeholder = brand === 'amex' ? 'CVC (4)' : 'CVC';
    clearError(number);
    if (digits.length === maxLen(brand)) expiry.focus();
  });
  expiry.addEventListener('input', function () {
    var digits = expiry.value.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 1 && Number(digits) > 1) digits = '0' + digits;
    expiry.value = digits.length > 2 ? digits.slice(0, 2) + ' / ' + digits.slice(2) : digits;
    clearError(expiry);
    if (digits.length === 4) cvc.focus();
  });
  expiry.addEventListener('keydown', function (e) {
    if (e.key === 'Backspace' && /\s\/\s$/.test(expiry.value)) {
      e.preventDefault();
      expiry.value = expiry.value.slice(0, -3);
    }
  });
  cvc.addEventListener('input', function () {
    cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4);
    clearError(cvc);
  });
  [email, holder].concat(Object.keys(b).map(function (k) { return b[k]; })).forEach(function (el) {
    el.addEventListener('input', function () { clearError(el); });
  });

  // ---- errores inline -----------------------------------------------------
  function errorEl(input) { return document.querySelector('[data-error-for="' + input.id + '"]'); }
  function setError(input, msg) {
    input.setAttribute('aria-invalid', 'true');
    var el = errorEl(input);
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }
  function clearError(input) {
    input.removeAttribute('aria-invalid');
    var el = errorEl(input);
    if (el) { el.textContent = ''; el.classList.remove('show'); }
  }
  function showFormError(msg) { formError.textContent = msg; formError.classList.add('show'); }
  function hideFormError() { formError.textContent = ''; formError.classList.remove('show'); }

  // ---- facturación ----------------------------------------------------------
  function billingOpen() { return S.billingRequired || !sameToggle.checked; }
  function syncBilling() {
    billingBody.hidden = !billingOpen();
    if (!billingBody.hidden && !b.name.value && !S.billingRequired) b.name.value = holder.value;
  }
  if (sameToggle) sameToggle.addEventListener('change', syncBilling);
  holder.addEventListener('input', function () {
    if (S.billingRequired && !b.name.dataset.touched) b.name.value = holder.value;
  });
  b.name.addEventListener('input', function () { b.name.dataset.touched = '1'; });
  b.rfc.addEventListener('input', function () { b.rfc.value = b.rfc.value.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '').slice(0, 13); });
  b.postalCode.addEventListener('input', function () {
    if (b.country.value === 'MX') b.postalCode.value = b.postalCode.value.replace(/\D/g, '').slice(0, 5);
  });
  syncBilling();

  // ---- validación -------------------------------------------------------------
  function validate() {
    var ok = true, first = null;
    function fail(input, msg) { setError(input, msg); ok = false; if (!first) first = input; }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) fail(email, 'Escribe un correo electrónico válido.');

    if (method === 'CARD') {
      var digits = cardDigits(), brand = detectBrand(digits);
      if (digits.length === 0) fail(number, 'Escribe el número de tu tarjeta.');
      else if (digits.length !== maxLen(brand) || !luhn(digits)) fail(number, 'El número de tarjeta no es válido.');

      var m = expiry.value.replace(/\D/g, '');
      var mm = Number(m.slice(0, 2)), yy = Number(m.slice(2, 4));
      if (m.length !== 4 || mm < 1 || mm > 12) fail(expiry, 'La fecha de vencimiento no es válida.');
      else {
        var now = new Date();
        var expYear = 2000 + yy;
        if (expYear < now.getFullYear() || (expYear === now.getFullYear() && mm < now.getMonth() + 1)) {
          fail(expiry, 'La tarjeta ya venció.');
        }
      }
      var cvcLen = brand === 'amex' ? 4 : 3;
      if (cvc.value.length !== cvcLen) fail(cvc, 'El código de seguridad debe tener ' + cvcLen + ' dígitos.');
      if (holder.value.trim().length < 2) fail(holder, 'Escribe el nombre tal como aparece en la tarjeta.');
    }

    if (billingOpen()) {
      if (b.name.value.trim().length < 2) fail(b.name, 'Escribe el nombre o razón social.');
      var rfc = b.rfc.value.trim();
      if (S.requiresInvoice && !rfc) fail(b.rfc, 'El RFC es obligatorio para emitir la factura.');
      else if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) fail(b.rfc, 'El RFC no tiene un formato válido.');
      if (!b.street.value.trim()) fail(b.street, 'Escribe la calle y número.');
      if (!b.city.value.trim()) fail(b.city, 'Escribe la ciudad.');
      if (!b.state.value.trim()) fail(b.state, 'Escribe el estado.');
      var cp = b.postalCode.value.trim();
      if (!cp) fail(b.postalCode, 'Escribe el código postal.');
      else if (b.country.value === 'MX' && !/^\d{5}$/.test(cp)) fail(b.postalCode, 'El código postal debe tener 5 dígitos.');
    }
    if (first) first.focus();
    return ok;
  }

  function collectBilling() {
    if (!billingOpen()) return undefined;
    return {
      name: b.name.value.trim(),
      rfc: b.rfc.value.trim() || undefined,
      street: b.street.value.trim(),
      neighborhood: b.neighborhood.value.trim() || undefined,
      city: b.city.value.trim(),
      state: b.state.value.trim(),
      postalCode: b.postalCode.value.trim(),
      country: b.country.value
    };
  }

  function setLoading(on) {
    payBtn.disabled = on;
    payBtn.classList.toggle('loading', on);
    $('payLabel').textContent = on ? 'Procesando…' : (S.payLabels[method] || S.payLabels.CARD);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideFormError();
    if (!validate()) return;
    var declined = false;
    var body = {
      email: email.value.trim(),
      paymentMethod: method,
      country: country.value,
      billing: collectBilling()
    };
    if (method === 'CARD') {
      var digits = cardDigits();
      var brand = detectBrand(digits);
      declined = digits === '4000000000000002';
      body.card = { brand: brand, last4: digits.slice(-4), holder: holder.value.trim() };
      if (declined) body.reason = 'CARD_DECLINED';
    }
    setLoading(true);
    fetch(BASE + '/checkout/sessions/' + S.id + (declined ? '/fail' : '/capture'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (!r.ok) {
        var msg = (r.data && r.data.message) || 'No pudimos procesar el pago. Revisa los datos.';
        var fields = r.data && r.data.fields;
        if (fields) Object.keys(fields).forEach(function (k) { if (b[k]) setError(b[k], fields[k]); });
        showFormError(msg);
        setLoading(false);
        return;
      }
      window.location.replace(BASE + '/checkout/' + S.id + '/hosted');
    }).catch(function () {
      showFormError('Error de red. Inténtalo de nuevo.');
      setLoading(false);
    });
  });
})();
`;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CARD: "Tarjeta",
  SPEI: "Transferencia SPEI",
  OXXO: "Efectivo en OXXO",
};

const METHOD_HEADING: Record<PaymentMethod, string> = {
  CARD: "Pagar con tarjeta",
  SPEI: "Pagar por transferencia",
  OXXO: "Pagar en efectivo",
};

const METHOD_ICON: Record<PaymentMethod, string> = {
  CARD: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 10h19" stroke="currentColor" stroke-width="1.6"/><path d="M6 14.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  SPEI: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 10.5 12 5l9 5.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 10.5V18M9.5 10.5V18M14.5 10.5V18M19 10.5V18M3 18.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  OXXO: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5 12 4l8 4.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 20v-6h6v6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
};

/** Métodos habilitados para la sesión, en el orden canónico del gateway. */
function methodsFor(session: InternalSession): PaymentMethod[] {
  const allowed = session.paymentMethods?.length ? session.paymentMethods : [...PAYMENT_METHODS];
  return PAYMENT_METHODS.filter((m) => allowed.includes(m));
}

function methodTabsHtml(methods: PaymentMethod[]): string {
  if (methods.length <= 1) return "";
  return `<div class="methods" role="tablist" aria-label="Método de pago">${methods
    .map(
      (m, i) =>
        `<button type="button" class="method" role="tab" data-method="${m}" aria-selected="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}">${METHOD_ICON[m]}<span>${escapeHtml(METHOD_LABEL[m])}</span></button>`,
    )
    .join("")}</div>`;
}

/** CLABE de 18 dígitos con el prefijo bancario de STP (646180) + referencia. */
export function speiClabe(reference: string): string {
  return `646180${reference.replace(/\D/g, "").padEnd(12, "0").slice(0, 12)}`;
}

/** Referencia OXXO de 14 dígitos agrupada de 4 en 4 para dictarla en caja. */
export function oxxoReference(reference: string): string {
  return reference.replace(/\D/g, "").padEnd(14, "0").slice(0, 14).replace(/(\d{4})(?=\d)/g, "$1-");
}

export function renderHostedCheckout(session: InternalSession): string {
  const merchant = session.merchantName?.trim() || "Comercio";
  const initial = merchant.charAt(0).toUpperCase();
  const total = session.totals?.total ?? session.amount;
  const payLabel = `Pagar ${formatMoney(total)} ${session.currency}`;
  const customerEmail = session.customer?.email ?? "";
  const customerName = session.customer?.fullName ?? "";
  const billingRequired = Boolean(session.billingRequired);
  const requiresInvoice = Boolean(session.requiresInvoice);
  const billingHint = requiresInvoice
    ? "Se usará para emitir tu factura (CFDI)."
    : billingRequired
      ? "Necesaria para completar la entrega."
      : "Opcional. Por defecto usamos los datos del titular.";

  const methods = methodsFor(session);
  const payLabels: Record<PaymentMethod, string> = {
    CARD: payLabel,
    SPEI: `Confirmar transferencia de ${formatMoney(total)}`,
    OXXO: `Simular pago en tienda de ${formatMoney(total)}`,
  };
  const clientSession = {
    id: session.id,
    billingRequired,
    requiresInvoice,
    payLabel,
    payLabels,
    paymentMethods: methods,
  };
  const clabe = speiClabe(session.paymentReference);
  const oxxoRef = oxxoReference(session.paymentReference);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(merchant)} · Pago</title>
<style>${BASE_CSS}${CHECKOUT_CSS}</style>
</head>
<body>
${testModeBanner()}
<main class="layout">
  <section class="summary" aria-label="Resumen del pedido">
    <div class="col">
      ${
        session.cancelUrl
          ? `<a class="back" href="${escapeHtml(session.cancelUrl)}"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Volver</a>`
          : ""
      }
      <div class="merchant">
        <span class="merchant-mark" aria-hidden="true">${escapeHtml(initial)}</span>
        <span class="merchant-name">${escapeHtml(merchant)}</span>
      </div>
      <p class="pay-to">Pagar a ${escapeHtml(merchant)}</p>
      <p class="total-big">${escapeHtml(formatMoney(total))}<span class="cur">${escapeHtml(session.currency)}</span></p>
      ${lineItemsHtml(session.lineItems)}
      ${totalsHtml(session)}
      ${poweredBy()}
    </div>
  </section>

  <section class="checkout" aria-label="Datos de pago">
    <div class="col">
      <h2>${methods.length > 1 ? "Elige cómo pagar" : METHOD_HEADING[methods[0] ?? "CARD"]}</h2>
      <form id="payForm" novalidate autocomplete="on">
        <div class="form-error" id="formError" role="alert"></div>

        ${methodTabsHtml(methods)}

        <div class="field">
          <label for="email">Correo electrónico</label>
          <input class="control" id="email" type="email" inputmode="email" autocomplete="email" placeholder="tu@correo.com" value="${escapeHtml(customerEmail)}">
          <p class="error" data-error-for="email"></p>
        </div>

        <div class="panel" id="panelSPEI" hidden>
          <div class="ref-box">
            <dl>
              <dt>Banco</dt><dd>STP (simulado)</dd>
              <dt>CLABE</dt><dd class="mono">${escapeHtml(clabe)}</dd>
              <dt>Beneficiario</dt><dd>${escapeHtml(merchant)}</dd>
              <dt>Concepto</dt><dd class="mono">${escapeHtml(session.paymentReference.slice(0, 7))}</dd>
              <dt>Importe exacto</dt><dd>${escapeHtml(formatMoney(total))} ${escapeHtml(session.currency)}</dd>
            </dl>
            <p class="ref-note">Con una pasarela real el pago se confirma cuando el banco avisa la transferencia. En este sandbox no hay banco: al pulsar el botón se simula esa confirmación.</p>
          </div>
        </div>

        <div class="panel" id="panelOXXO" hidden>
          <div class="ref-box">
            <dl>
              <dt>Referencia</dt><dd class="mono">${escapeHtml(oxxoRef)}</dd>
              <dt>Importe</dt><dd>${escapeHtml(formatMoney(total))} ${escapeHtml(session.currency)}</dd>
              <dt>Comisión</dt><dd>$0.00 (simulada)</dd>
              <dt>Vence</dt><dd>${escapeHtml(formatDate(session.expiresAt))}</dd>
            </dl>
            <p class="ref-note">En una tienda real dictas la referencia en caja y el pago tarda hasta 24 h en verse reflejado. Aquí el botón simula que la tienda ya reportó el pago.</p>
          </div>
        </div>

        <div class="panel" id="panelCARD">
        <div class="field">
          <span class="legend">Información de la tarjeta</span>
          <div class="group">
            <div class="card-number">
              <label class="sr-only" for="cardNumber">Número de tarjeta</label>
              <input class="control" id="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" maxlength="19">
              <span class="brand" id="brand" data-brand="unknown">${CARD_BRAND_SVGS}</span>
            </div>
            <div class="group-row">
              <label class="sr-only" for="cardExpiry">Vencimiento</label>
              <input class="control" id="cardExpiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / AA" maxlength="7">
              <label class="sr-only" for="cardCvc">CVC</label>
              <input class="control" id="cardCvc" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" maxlength="3">
            </div>
          </div>
          <p class="error" data-error-for="cardNumber"></p>
          <p class="error" data-error-for="cardExpiry"></p>
          <p class="error" data-error-for="cardCvc"></p>
        </div>

        <div class="field">
          <label for="cardName">Nombre en la tarjeta</label>
          <input class="control" id="cardName" autocomplete="cc-name" placeholder="Nombre completo" value="${escapeHtml(customerName)}">
          <p class="error" data-error-for="cardName"></p>
        </div>
        </div>

        <div class="field">
          <label for="country">País o región</label>
          <select class="control" id="country" autocomplete="country">${countryOptions()}</select>
        </div>

        <section class="billing" aria-labelledby="billingTitle">
          <div class="billing-head">
            <div>
              <h3 id="billingTitle">Dirección de facturación</h3>
              <p>${billingHint}</p>
            </div>
            ${
              billingRequired
                ? `<span class="badge-req">Obligatoria</span>`
                : `<label class="toggle"><input type="checkbox" id="sameAsHolder" checked> Misma que la del titular</label>`
            }
          </div>
          <div class="billing-body" id="billingBody"${billingRequired ? "" : " hidden"}>
            <div class="field">
              <label for="bName">Nombre o razón social</label>
              <input class="control" id="bName" autocomplete="billing name" value="${escapeHtml(customerName)}">
              <p class="error" data-error-for="bName"></p>
            </div>
            <div class="field">
              <label for="bRfc">RFC${requiresInvoice ? "" : " (opcional)"}</label>
              <input class="control" id="bRfc" placeholder="XAXX010101000" maxlength="13" autocapitalize="characters" spellcheck="false">
              <p class="error" data-error-for="bRfc"></p>
            </div>
            <div class="field">
              <label for="bStreet">Calle y número</label>
              <input class="control" id="bStreet" autocomplete="billing address-line1">
              <p class="error" data-error-for="bStreet"></p>
            </div>
            <div class="field">
              <label for="bNeighborhood">Colonia (opcional)</label>
              <input class="control" id="bNeighborhood" autocomplete="billing address-line2">
              <p class="error" data-error-for="bNeighborhood"></p>
            </div>
            <div class="row2">
              <div class="field">
                <label for="bCity">Ciudad</label>
                <input class="control" id="bCity" autocomplete="billing address-level2">
                <p class="error" data-error-for="bCity"></p>
              </div>
              <div class="field">
                <label for="bState">Estado</label>
                <input class="control" id="bState" autocomplete="billing address-level1">
                <p class="error" data-error-for="bState"></p>
              </div>
            </div>
            <div class="row2">
              <div class="field">
                <label for="bPostalCode">Código postal</label>
                <input class="control" id="bPostalCode" inputmode="numeric" autocomplete="billing postal-code" maxlength="10">
                <p class="error" data-error-for="bPostalCode"></p>
              </div>
              <div class="field">
                <label for="bCountry">País</label>
                <select class="control" id="bCountry" autocomplete="billing country">${countryOptions()}</select>
              </div>
            </div>
          </div>
        </section>

        <button type="submit" class="btn btn-primary" id="payBtn">
          <span class="spinner" aria-hidden="true"></span>
          <span id="payLabel">${escapeHtml(payLabel)}</span>
        </button>
        <p class="terms">Al pagar aceptas los términos de ${escapeHtml(merchant)}. Este cobro es simulado: no se envía nada a un procesador real.</p>
      </form>
      ${poweredBy()}
    </div>
  </section>
</main>
<script>window.__SESSION__ = ${jsonForScript(clientSession)};</script>
<script>${CHECKOUT_JS}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// pantallas de resultado
// ---------------------------------------------------------------------------

const RESULT_CSS = `
  body{background:var(--bg-muted)}
  .wrap{min-height:calc(100vh - 41px);display:flex;align-items:flex-start;justify-content:center;padding:2.5rem 1rem 3rem}
  .card{background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);width:100%;max-width:480px;padding:2rem 1.75rem}
  @media(max-width:480px){.card{padding:1.5rem 1.15rem}}
  .icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.15rem}
  .icon svg{width:34px;height:34px}
  .icon.ok{background:var(--success-bg);color:var(--success)}
  .icon.bad{background:var(--danger-bg);color:var(--danger)}
  h1{margin:0;text-align:center;font-size:22px;font-weight:600;letter-spacing:-.01em}
  .sub{margin:.35rem 0 0;text-align:center;color:var(--text-2);font-size:14.5px}
  .amount{margin:1.25rem 0 .1rem;text-align:center;font-size:34px;font-weight:600;letter-spacing:-.02em}
  .amount .cur{font-size:14px;color:var(--text-2);font-weight:500;margin-left:.3rem;letter-spacing:0}
  .to{margin:0 0 1.5rem;text-align:center;color:var(--text-2);font-size:14px}
  .details{margin:0;padding:1rem 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:grid;grid-template-columns:auto 1fr;gap:.55rem 1rem;font-size:14px}
  .details dt{color:var(--text-2);margin:0}
  .details dd{margin:0;text-align:right;overflow-wrap:anywhere}
  .details code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--bg-muted);padding:.1rem .4rem;border-radius:4px}
  .card-chip{display:inline-flex;align-items:center;gap:.4rem;justify-content:flex-end}
  .card-chip svg{width:28px;height:18px}
  .receipt{margin-top:1.25rem}
  .receipt h2{font-size:13px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;margin:0 0 .75rem}
  .items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem}
  .item{display:flex;justify-content:space-between;gap:1rem;font-size:14px}
  .item-main{display:flex;flex-direction:column;min-width:0}
  .item-title{font-weight:500;overflow-wrap:anywhere}
  .item-meta{color:var(--text-2);font-size:12.5px}
  .item-total{white-space:nowrap}
  .totals{margin:.9rem 0 0;padding-top:.75rem;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:.35rem}
  .trow{display:flex;justify-content:space-between;font-size:13.5px;color:var(--text-2)}
  .trow dt,.trow dd{margin:0}
  .trow.grand{color:var(--text);font-weight:600;font-size:14.5px;padding-top:.4rem}
  .trow .cur{font-size:12px;color:var(--text-2);font-weight:500}
  .billing-box{margin-top:1.25rem;font-size:13.5px;color:var(--text-2);line-height:1.5}
  .billing-box b{color:var(--text);font-weight:600;display:block;margin-bottom:.15rem}
  .actions{margin-top:1.5rem;display:flex;flex-direction:column;gap:.6rem}
  .hint{text-align:center;color:var(--text-3);font-size:13px;margin:.85rem 0 0}
  .powered{justify-content:center;margin-top:1.5rem}
`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

/** "Método de pago" del comprobante: tarjeta con marca, o el método diferido con su referencia. */
function methodChip(session: InternalSession): string {
  const method = session.paymentMethod ?? (session.card ? "CARD" : undefined);
  if (method === "SPEI") {
    return `${escapeHtml(METHOD_LABEL.SPEI)} · <code>${escapeHtml(session.paymentReference.slice(0, 7))}</code>`;
  }
  if (method === "OXXO") {
    return `${escapeHtml(METHOD_LABEL.OXXO)} · <code>${escapeHtml(oxxoReference(session.paymentReference))}</code>`;
  }
  return cardChip(session);
}

function cardChip(session: InternalSession): string {
  const card = session.card;
  if (!card) return "—";
  const label = BRAND_LABEL[card.brand] ?? "Tarjeta";
  return `<span class="card-chip"><span class="brand" data-brand="${escapeHtml(card.brand)}" style="position:static;transform:none">${CARD_BRAND_SVGS}</span>${escapeHtml(label)} •••• ${escapeHtml(card.last4)}</span>`;
}

function billingBox(session: InternalSession): string {
  const bl = session.billing;
  if (!bl) return "";
  const parts = [
    bl.street,
    bl.neighborhood,
    [bl.postalCode, bl.city].filter(Boolean).join(" "),
    bl.state,
    bl.country,
  ].filter(Boolean);
  return `<div class="billing-box">
    <b>Facturar a</b>
    ${escapeHtml(bl.name)}${bl.rfc ? ` · RFC ${escapeHtml(bl.rfc)}` : ""}<br>
    ${escapeHtml(parts.join(", "))}
  </div>`;
}

function resultShell(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${RESULT_CSS}${css}
  .brand svg{width:28px;height:18px;display:none}
  .brand[data-brand="visa"] .b-visa,.brand[data-brand="mastercard"] .b-mc,.brand[data-brand="amex"] .b-amex,.brand[data-brand="unknown"] .b-generic{display:block}
</style>
</head>
<body>
${testModeBanner()}
<main class="wrap">
  <div class="card">
    ${body}
    ${poweredBy()}
  </div>
</main>
</body>
</html>`;
}

export function renderHostedSuccess(session: InternalSession): string {
  const merchant = session.merchantName?.trim() || "Comercio";
  const total = session.totals?.total ?? session.amount;
  const email = session.email ?? session.customer?.email;
  const body = `
    <div class="icon ok">${CHECK_SVG}</div>
    <h1>Pago confirmado</h1>
    <p class="sub">Gracias por tu compra. ${email ? `Enviamos el comprobante a <b>${escapeHtml(email)}</b>.` : "Guarda esta referencia para cualquier aclaración."}</p>
    <p class="amount">${escapeHtml(formatMoney(total))}<span class="cur">${escapeHtml(session.currency)}</span></p>
    <p class="to">Pagado a ${escapeHtml(merchant)}</p>
    <dl class="details">
      <dt>Método de pago</dt><dd>${methodChip(session)}</dd>
      <dt>Fecha</dt><dd>${escapeHtml(formatDate(session.capturedAt))}</dd>
      <dt>Referencia</dt><dd><code>${escapeHtml(session.id)}</code></dd>
      <dt>Pedido</dt><dd><code>${escapeHtml(session.orderId.slice(0, 8))}</code></dd>
    </dl>
    ${
      session.lineItems && session.lineItems.length
        ? `<section class="receipt"><h2>Resumen</h2>${lineItemsHtml(session.lineItems, true)}${totalsHtml(session)}</section>`
        : ""
    }
    ${billingBox(session)}
    <div class="actions">
      ${
        session.successUrl
          ? `<a class="btn btn-primary" href="${escapeHtml(session.successUrl)}">Volver a la tienda</a>`
          : `<p class="hint">Ya puedes cerrar esta ventana y volver a la tienda.</p>`
      }
    </div>`;
  return resultShell(`Pago confirmado · ${merchant}`, "", body);
}

export function renderHostedFailure(session: InternalSession): string {
  const merchant = session.merchantName?.trim() || "Comercio";
  const total = session.totals?.total ?? session.amount;
  const declined = session.failureReason === "CARD_DECLINED";
  const body = `
    <div class="icon bad">${CROSS_SVG}</div>
    <h1>${declined ? "Tarjeta rechazada" : "Pago no completado"}</h1>
    <p class="sub">${
      declined
        ? "Tu banco rechazó la tarjeta. No se realizó ningún cargo; intenta con otra tarjeta."
        : "No pudimos completar el pago. No se realizó ningún cargo."
    }</p>
    <p class="amount">${escapeHtml(formatMoney(total))}<span class="cur">${escapeHtml(session.currency)}</span></p>
    <p class="to">Pago a ${escapeHtml(merchant)}</p>
    <dl class="details">
      ${session.card ? `<dt>Tarjeta</dt><dd>${cardChip(session)}</dd>` : ""}
      <dt>Fecha</dt><dd>${escapeHtml(formatDate(session.failedAt))}</dd>
      <dt>Referencia</dt><dd><code>${escapeHtml(session.id)}</code></dd>
      <dt>Motivo</dt><dd><code>${escapeHtml(session.failureReason ?? "GENERIC_DECLINE")}</code></dd>
    </dl>
    <div class="actions">
      ${
        session.cancelUrl
          ? `<a class="btn btn-primary" href="${escapeHtml(session.cancelUrl)}">Intentar de nuevo</a>`
          : `<p class="hint">Vuelve a la tienda y genera un nuevo link de pago para intentarlo de nuevo.</p>`
      }
    </div>`;
  return resultShell(`Pago rechazado · ${merchant}`, "", body);
}

/** Estados terminales sin pantalla propia (REFUNDED, CANCELLED, …). */
export function renderHostedStatus(session: InternalSession): string {
  const merchant = session.merchantName?.trim() || "Comercio";
  const body = `
    <div class="icon ok">${CHECK_SVG}</div>
    <h1>Sesión ${escapeHtml(session.status)}</h1>
    <p class="sub">Esta sesión de pago ya no admite cambios.</p>
    <dl class="details">
      <dt>Referencia</dt><dd><code>${escapeHtml(session.id)}</code></dd>
      <dt>Importe</dt><dd>${escapeHtml(formatMoney(session.amount))} ${escapeHtml(session.currency)}</dd>
    </dl>
    <div class="actions">
      ${session.successUrl ? `<a class="btn btn-secondary" href="${escapeHtml(session.successUrl)}">Volver a la tienda</a>` : ""}
    </div>`;
  return resultShell(`${session.status} · ${merchant}`, "", body);
}

export function renderHostedNotFound(): string {
  const body = `
    <div class="icon bad">${CROSS_SVG}</div>
    <h1>Sesión no encontrada</h1>
    <p class="sub">El link de pago no existe o ya expiró. Vuelve a la tienda y genera uno nuevo.</p>`;
  return resultShell("Sesión no encontrada", "", body);
}
