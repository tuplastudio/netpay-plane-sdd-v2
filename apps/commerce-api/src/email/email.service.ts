/**
 * Envío de correo transaccional vía Resend, con plantillas Handlebars.
 *
 * Sin RESEND_API_KEY configurada, degrada a "simulado" (mismo patrón que
 * PAYMENT_PROVIDER=DUMMY y el resto de canales sin proveedor real en este
 * proyecto): no rompe el flujo, solo no manda el correo de verdad.
 */
import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
// Proyecto compila a CommonJS (ver tsconfig.nest.json): `__dirname` es
// global del módulo compilado, no hace falta derivarlo de `import.meta`.

export interface SendEmailInput {
  to: string;
  subject: string;
  template: "invitation" | "notification" | "passwordReset";
  vars: Record<string, unknown>;
  from?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly compiled = new Map<string, HandlebarsTemplateDelegate>();

  private get apiKey(): string {
    return process.env.RESEND_API_KEY ?? "";
  }

  private get defaultFrom(): string {
    return process.env.RESEND_FROM_EMAIL ?? "Atiende ya by Tupla <onboarding@resend.dev>";
  }

  private compile(template: string): HandlebarsTemplateDelegate {
    const cached = this.compiled.get(template);
    if (cached) return cached;
    // dist/src/email/templates en build (copiado por nest-cli.json `assets`),
    // src/email/templates en dev (`nest start --watch` copia igual con watch).
    const source = readFileSync(join(__dirname, "templates", `${template}.hbs`), "utf-8");
    const fn = Handlebars.compile(source, { noEscape: false });
    this.compiled.set(template, fn);
    return fn;
  }

  /**
   * Lanza si el envío real falla (Resend configurada pero rechazó o no
   * respondió): el llamador decide si eso amerita reintento, igual que
   * `whatsapp.send()`. Sin RESEND_API_KEY, degrada a simulado y NO lanza —
   * un tenant sin la key configurada no debe entrar en un loop de reintentos.
   */
  async send(input: SendEmailInput): Promise<{ sent: boolean; id?: string }> {
    const html = this.compile(input.template)(input.vars);

    if (!this.apiKey) {
      this.logger.log(`[simulado, sin RESEND_API_KEY] correo a ${input.to}: ${input.subject}`);
      return { sent: false };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: input.from ?? this.defaultFrom,
        to: [input.to],
        subject: input.subject,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend respondió ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: string };
    return { sent: true, id: data.id };
  }
}
