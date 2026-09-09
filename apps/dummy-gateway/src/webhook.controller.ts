import { Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { createHmac } from "node:crypto";

/**
 * Webhook entrante de prueba para validar la firma HMAC.
 */
@Controller("webhooks")
export class WebhookController {
  @Post("verify")
  verify(@Req() req: Request) {
    const signature = req.headers["x-dummy-signature"] as string | undefined;
    const secret = (req.body as { secret?: string }).secret ?? "";
    const raw = JSON.stringify(req.body);
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    return {
      data: {
        valid: signature === expected,
        provided: signature,
        expected,
      },
      requestId: "verify",
    };
  }
}