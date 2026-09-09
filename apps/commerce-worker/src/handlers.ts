import { Logger } from "@nestjs/common";

/**
 * Manejadores de eventos del inbox.
 *
 * Cada manejador debe ser idempotente por su cuenta: el inbox garantiza que un
 * `eventId` no se procesa dos veces, pero un reinicio entre el efecto y la
 * marca `PROCESSED` puede repetir la llamada.
 */

export interface InboxEnvelope {
  eventName: string;
  tenantId: string;
  eventId: string;
  payload: unknown;
}

export type EventHandler = (envelope: InboxEnvelope) => Promise<void>;

const logger = new Logger("InboxHandlers");

/**
 * Registro de manejadores por nombre de evento. Los efectos comerciales
 * (notificaciones, reservas, conciliación) se registran aquí conforme se
 * habilitan; lo no registrado se traza y se reconoce como procesado.
 */
export const HANDLERS: Record<string, EventHandler> = {};

export function registerHandler(eventName: string, handler: EventHandler): void {
  HANDLERS[eventName] = handler;
}

export async function handleEvent(envelope: InboxEnvelope): Promise<void> {
  const handler = HANDLERS[envelope.eventName];
  if (!handler) {
    logger.log(
      `Evento sin manejador: ${envelope.eventName} (tenant=${envelope.tenantId}, id=${envelope.eventId})`,
    );
    return;
  }
  await handler(envelope);
}
