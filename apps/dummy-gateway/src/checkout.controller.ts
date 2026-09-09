import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { CheckoutStore } from "./checkout.store.js";
import { WebhookDispatcher } from "./webhook.dispatcher.js";

/**
 * API del simulador. Ver docs/09-pay.md.
 *  - POST /checkout/sessions      crear sesión (autenticado por service key)
 *  - GET  /checkout/:id           ver sesión
 *  - POST /checkout/:id/capture   simular captura exitosa
 *  - POST /checkout/:id/fail      simular fallo
 *  - GET  /checkout/:id/hosted    página hosted (HTML simple, devuelve ok)
 */
@Controller("checkout")
export class CheckoutController {
  constructor(
    private readonly store: CheckoutStore,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  @Post("sessions")
  async create(
    @Body() body: {
      amount: string;
      currency: "MXN";
      orderId: string;
      metadata?: Record<string, string>;
      successUrl?: string;
      cancelUrl?: string;
      webhookUrl?: string;
      secret?: string;
    },
    @Headers("authorization") auth?: string,
  ) {
    const apiKey = this.extractApiKey(auth);
    const session = this.store.create({
      amount: body.amount,
      currency: body.currency,
      orderId: body.orderId,
      metadata: body.metadata,
      serviceApiKey: apiKey,
      webhookUrl: body.webhookUrl,
      webhookSecret: body.secret,
    });

    return {
      data: {
        id: session.id,
        hostedUrl: `/checkout/${session.id}/hosted`,
        expiresAt: session.expiresAt,
        livemode: false,
      },
      requestId: session.id,
    };
  }

  @Get("sessions/:id")
  get(@Param("id") id: string) {
    const session = this.store.get(id);
    if (!session) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no encontrada" });
    }
    return {
      data: {
        id: session.id,
        orderId: session.orderId,
        amount: session.amount,
        currency: session.currency,
        status: session.status,
        livemode: false,
        expiresAt: session.expiresAt,
      },
      requestId: session.id,
    };
  }

  @Post("sessions/:id/capture")
  async capture(@Param("id") id: string, @Body() body: { reason?: string } = {}) {
    void body;
    const session = this.store.setStatus(id, "CAPTURED");
    if (!session) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no encontrada" });
    }
    if (session.webhookUrl && session.webhookSecret) {
      await this.webhooks.dispatch(session.webhookUrl, session, session.webhookSecret);
      this.store.markWebhookDelivered(id);
    }
    return { data: { id: session.id, status: session.status }, requestId: session.id };
  }

  @Post("sessions/:id/fail")
  async fail(@Param("id") id: string, @Body() body: { reason?: string } = {}) {
    const session = this.store.setStatus(id, "FAILED");
    if (!session) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no encontrada" });
    }
    if (session.webhookUrl && session.webhookSecret) {
      await this.webhooks.dispatch(session.webhookUrl, session, session.webhookSecret);
      this.store.markWebhookDelivered(id);
    }
    return {
      data: { id: session.id, status: session.status, reason: body.reason ?? "GENERIC_DECLINE" },
      requestId: session.id,
    };
  }

  @Get(":id/hosted")
  @Header("content-type", "text/html; charset=utf-8")
  hosted(@Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    // helmet() aplica un CSP global sin 'unsafe-inline'; esta página necesita
    // su <script>/<style> inline para el botón Pagar, así que se relaja aquí.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    );
    const session = this.store.get(id);
    if (!session) {
      res.status(404);
      return "<h1>Sesión no encontrada</h1>";
    }
    if (session.status !== "PENDING") {
      return this.renderResultPage(session.status);
    }
    return this.renderPayPage(id, session.amount, session.currency);
  }

  private renderPayPage(id: string, amount: string, currency: string): string {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NetPay Checkout</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1.5rem}
  .card{background:#fff;border-radius:16px;padding:2rem;max-width:400px;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.08)}
  .brand{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-bottom:.25rem}
  .brand-mark{width:24px;height:24px;border-radius:6px;background:#e11d48;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px}
  .brand-name{font-weight:700;font-size:1.05rem;letter-spacing:-.01em}
  .badge{display:block;text-align:center;font-size:.7rem;text-transform:uppercase;color:#9ca3af;letter-spacing:.05em;margin-bottom:1.25rem}
  .amount{font-size:2rem;font-weight:700;text-align:center;margin:0 0 1.5rem;font-family:ui-monospace,monospace}
  label{display:block;font-size:.75rem;font-weight:600;color:#374151;margin-bottom:.25rem}
  .field{margin-bottom:.9rem}
  .row{display:flex;gap:.75rem}
  .row .field{flex:1}
  input{width:100%;padding:.6rem .75rem;border:1px solid #d1d5db;border-radius:8px;font-size:.95rem;font-family:ui-monospace,monospace;outline:none}
  input:focus{border-color:#e11d48;box-shadow:0 0 0 3px rgba(225,29,72,.12)}
  input.invalid{border-color:#dc2626}
  button{width:100%;padding:.8rem;border-radius:10px;border:none;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.35rem}
  button:disabled{opacity:.5;cursor:not-allowed}
  .pay{background:#e11d48;color:#fff}
  .fail{background:transparent;color:#6b7280;border:1px solid #e5e7eb;margin-top:.6rem}
  #msg{margin-top:1rem;text-align:center;font-size:.85rem;color:#6b7280;min-height:1.2em}
  .lock{text-align:center;margin-top:1rem;font-size:.7rem;color:#9ca3af}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <span class="brand-mark">N</span>
      <span class="brand-name">NetPay</span>
    </div>
    <span class="badge">Sandbox de pruebas · sin dinero real</span>
    <p class="amount">$${amount} <span style="font-size:1.1rem;color:#9ca3af">${currency}</span></p>

    <form id="payForm">
      <div class="field">
        <label for="cardName">Nombre en la tarjeta</label>
        <input id="cardName" autocomplete="cc-name" placeholder="Nombre Apellido" required>
      </div>
      <div class="field">
        <label for="cardNumber">Número de tarjeta</label>
        <input id="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="19" required>
      </div>
      <div class="row">
        <div class="field">
          <label for="cardExpiry">Vencimiento</label>
          <input id="cardExpiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" maxlength="5" required>
        </div>
        <div class="field">
          <label for="cardCvv">CVV</label>
          <input id="cardCvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" required>
        </div>
      </div>
      <button type="submit" class="pay" id="payBtn">Pagar $${amount} ${currency}</button>
    </form>
    <button type="button" class="fail" id="failBtn">Simular pago rechazado</button>
    <p id="msg"></p>
    <p class="lock">🔒 Datos de prueba — no se envían a ningún procesador real.</p>
  </div>
  <script>
    const nameEl = document.getElementById('cardName');
    const numberEl = document.getElementById('cardNumber');
    const expiryEl = document.getElementById('cardExpiry');
    const cvvEl = document.getElementById('cardCvv');
    const msgEl = document.getElementById('msg');
    const payBtn = document.getElementById('payBtn');
    const failBtn = document.getElementById('failBtn');

    numberEl.addEventListener('input', () => {
      const digits = numberEl.value.replace(/\\D/g, '').slice(0, 16);
      numberEl.value = digits.replace(/(.{4})/g, '$1 ').trim();
    });
    expiryEl.addEventListener('input', () => {
      const digits = expiryEl.value.replace(/\\D/g, '').slice(0, 4);
      expiryEl.value = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
    });
    cvvEl.addEventListener('input', () => {
      cvvEl.value = cvvEl.value.replace(/\\D/g, '').slice(0, 4);
    });

    function validCard() {
      const digits = numberEl.value.replace(/\\s/g, '');
      const [mm, yy] = expiryEl.value.split('/');
      const expiryOk = /^\\d{2}$/.test(mm) && /^\\d{2}$/.test(yy) && Number(mm) >= 1 && Number(mm) <= 12;
      return nameEl.value.trim().length > 1 && digits.length >= 13 && digits.length <= 16 && expiryOk && /^\\d{3,4}$/.test(cvvEl.value);
    }

    async function act(path, label, disableForm) {
      msgEl.textContent = 'Procesando…';
      payBtn.disabled = true;
      failBtn.disabled = true;
      try {
        const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const data = await res.json();
        msgEl.textContent = label + ': ' + (data.data ? data.data.status : 'error');
        setTimeout(() => window.location.reload(), 700);
      } catch (e) {
        msgEl.textContent = 'Error de red';
        payBtn.disabled = false;
        failBtn.disabled = false;
      }
    }

    document.getElementById('payForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validCard()) {
        msgEl.textContent = 'Revisa los datos de la tarjeta.';
        return;
      }
      act('/checkout/sessions/${id}/capture', 'Pago');
    });
    failBtn.addEventListener('click', () => act('/checkout/sessions/${id}/fail', 'Resultado'));
  </script>
</body>
</html>`;
  }

  private renderResultPage(status: string): string {
    const ok = status === "CAPTURED";
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NetPay Checkout</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1.5rem}
  .card{background:#fff;border-radius:16px;padding:2rem;max-width:360px;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.08);text-align:center}
  .brand{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-bottom:1.25rem}
  .brand-mark{width:24px;height:24px;border-radius:6px;background:#e11d48;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px}
  .brand-name{font-weight:700;font-size:1.05rem;letter-spacing:-.01em}
  .status{font-size:1.25rem;font-weight:700;color:${ok ? "#16a34a" : "#dc2626"};margin:0 0 .5rem}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <span class="brand-mark">N</span>
      <span class="brand-name">NetPay</span>
    </div>
    <p class="status">${ok ? "✓ Pago capturado" : `✕ Sesión ${status}`}</p>
    <p>Puedes cerrar esta ventana y volver a la app.</p>
  </div>
</body>
</html>`;
  }

  private extractApiKey(auth: string | undefined): string {
    if (!auth || !auth.startsWith("Bearer ")) {
      throw new ForbiddenException({ code: "UNAUTHORIZED", message: "Service key requerida" });
    }
    const key = auth.slice("Bearer ".length).trim();
    if (!key) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Service key vacía" });
    }
    return key;
  }
}