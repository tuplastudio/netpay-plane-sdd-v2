import { Injectable } from "@nestjs/common";
import { EmailService } from "../email/email.service.js";

export interface PasswordResetMailInput {
  email: string;
  fullName?: string | null;
  resetUrl: string;
  primaryColor: string;
  accentColor: string;
}

@Injectable()
export class PasswordResetMailer {
  constructor(private readonly email: EmailService) {}

  async sendBestEffort(input: PasswordResetMailInput): Promise<void> {
    await this.email
      .send({
        to: input.email,
        subject: "Restablece tu contraseña",
        template: "passwordReset",
        vars: {
          email: input.email,
          fullName: input.fullName,
          resetUrl: input.resetUrl,
          primaryColor: input.primaryColor,
          accentColor: input.accentColor,
        },
      })
      .catch(() => undefined);
  }
}
