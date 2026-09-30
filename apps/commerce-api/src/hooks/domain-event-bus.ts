/**
 * Bus de eventos de dominio (en proceso).
 *
 * Los servicios de negocio anuncian que una acción TERMINÓ (pedido creado,
 * cotización emitida, pago acreditado...) con una sola línea:
 *
 *   await domainEvents.emit(tenantId, "order.created", orderEventData(order));
 *
 * El bus no sabe de hooks ni de HTTP: sólo arma el sobre estándar y avisa a
 * quien esté suscrito (hoy, `OutboundHookService`, que materializa una
 * entrega por hook activo). Es un singleton de módulo y no un provider de
 * Nest a propósito: así los servicios no cambian de constructor (sus tests
 * los instancian a mano) y, sin suscriptores, `emit` es un no-op.
 *
 * `emit` nunca lanza: un fallo al encolar hooks no debe deshacer la acción de
 * negocio que ya se confirmó. Se registra y se sigue.
 *
 * El outbox de RabbitMQ (`OutboxEvent`) sigue existiendo para el worker; hoy
 * ningún servicio escribe en él, por eso los hooks se cuelgan de este bus y
 * no de ahí.
 */

import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/** Sobre estándar que reciben los sistemas externos. */
export interface DomainEvent<T = Record<string, unknown>> {
  /** UUID del evento: el mismo para todos los hooks que lo reciben. */
  id: string;
  /** Nombre `<entidad>.<acción>`: `order.created`, `quote.issued`, ... */
  event: string;
  /** ISO-8601 (UTC). */
  occurredAt: string;
  tenantId: string;
  data: T;
  /** Versión del contrato del sobre. */
  version: 1;
}

export type DomainEventSubscriber = (event: DomainEvent) => Promise<void> | void;

/** Arma el sobre estándar sin publicarlo. */
export function buildDomainEvent(
  tenantId: string,
  eventName: string,
  data: Record<string, unknown>,
  now: Date = new Date(),
): DomainEvent {
  return {
    id: randomUUID(),
    event: eventName,
    occurredAt: now.toISOString(),
    tenantId,
    data,
    version: 1,
  };
}

export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly subscribers = new Set<DomainEventSubscriber>();

  /** Registra un suscriptor. Devuelve la función para darlo de baja. */
  subscribe(fn: DomainEventSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** Cuántos suscriptores hay (para tests y diagnóstico). */
  get size(): number {
    return this.subscribers.size;
  }

  /**
   * Publica un evento. Los suscriptores se invocan en orden y sus errores se
   * registran sin propagarse. Devuelve el sobre emitido.
   */
  async emit(
    tenantId: string,
    eventName: string,
    data: Record<string, unknown>,
    now: Date = new Date(),
  ): Promise<DomainEvent> {
    const event = buildDomainEvent(tenantId, eventName, data, now);
    for (const fn of this.subscribers) {
      try {
        await fn(event);
      } catch (err) {
        this.logger.error(`suscriptor falló para ${eventName} (tenant=${tenantId}): ${String(err)}`);
      }
    }
    return event;
  }
}

/** Instancia única del proceso. */
export const domainEvents = new DomainEventBus();
