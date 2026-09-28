/**
 * Enmascarado de datos personales para LOGS (nunca para respuestas: ahí se
 * omiten). Un solo lugar para que invitaciones, correos y notificaciones no
 * diverjan.
 */

/** `ana@x.mx` → `a***@x.mx`. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "?";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Correo o teléfono: correo como `maskEmail`, teléfono como `***1234`. */
export function maskRecipient(to: string | null | undefined): string {
  if (!to) return "?";
  if (to.lastIndexOf("@") > 0) return maskEmail(to);
  const digits = to.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}
