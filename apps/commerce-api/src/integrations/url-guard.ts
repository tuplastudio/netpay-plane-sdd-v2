/**
 * Guardia anti-SSRF para URLs que configura un tenant (endpoint OUTBOUND).
 *
 * Sin esto, `publishOutbound` hacía fetch a cualquier URL: un tenant podía
 * apuntar su integración a servicios internos (http://agent-v2:8010,
 * dummy-gateway, localhost) o al metadata del proveedor (169.254.169.254) y
 * usar el API como proxy hacia la red privada.
 *
 * Reglas:
 *  - solo http/https, sin credenciales en la URL;
 *  - el hostname debe ser un FQDN público: nada de nombres de un solo label
 *    (nombres de servicio docker), ni sufijos internos (.internal, .local, ...);
 *  - se resuelve el DNS y se rechaza si CUALQUIER dirección es privada,
 *    loopback, link-local, CGNAT, multicast, reservada o de metadata.
 *
 * Limitación conocida: entre la validación y el fetch el DNS podría cambiar
 * (DNS rebinding). Se mitiga validando justo antes de cada fetch y sin seguir
 * redirecciones (`redirect: "manual"` en el llamador).
 */

import { BadRequestException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
  ".private",
  ".svc",
  ".cluster.local",
];

const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal"]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "esta" red
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + metadata cloud
  ["172.16.0.0", 12], // privada (incluye redes docker por defecto)
  ["192.0.0.0", 24], // IETF
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada + broadcast
];

/** true si la IP (v4 o v6) NO es enrutable públicamente. */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return V4_BLOCKED.some(([base, bits]) => inCidr4(ip, base, bits));
  if (family !== 6) return true;

  const lower = ip.toLowerCase().split("%")[0] ?? "";
  // IPv4 embebida (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d).
  const embedded = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded?.[1]) return isBlockedIp(embedded[1]);
  // ::ffff:7f00:1 (mapeada en hex).
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1] ?? "0", 16);
    const lo = parseInt(mappedHex[2] ?? "0", 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower === "::" || lower === "::1") return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (obsoleta)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && lower.startsWith("2001:db8")) return true; // documentación
  if (lower.startsWith("64:ff9b:")) return true; // NAT64 (puede envolver IPv4 privada)
  if (first === 0x2002) return true; // 6to4 (puede envolver IPv4 privada)
  if (first === 0) return true; // ::/8 reservada (IPv4-compat, etc.)
  return false;
}

function reject(message: string): never {
  throw new BadRequestException({ code: "VALIDATION_ERROR", message });
}

/**
 * Valida sintaxis y hostname (sin DNS). Devuelve la URL parseada.
 * Útil al crear/editar para dar error inmediato.
 */
export function assertUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject("endpoint debe ser una URL válida");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    reject("endpoint debe usar http o https");
  }
  if (url.username || url.password) {
    reject("endpoint no puede incluir credenciales");
  }
  // URL.hostname deja IPv6 entre corchetes.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) reject("endpoint sin host");
  if (isIP(host)) {
    if (isBlockedIp(host)) reject("endpoint apunta a una dirección privada o reservada");
    return url;
  }
  if (BLOCKED_HOSTS.has(host) || !host.includes(".")) {
    reject("endpoint debe ser un dominio público (FQDN)");
  }
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    reject("endpoint apunta a un dominio interno");
  }
  return url;
}

/**
 * Validación completa: forma + resolución DNS. Rechaza si alguna dirección
 * resuelta no es pública. Llamar justo antes de cada fetch saliente.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = assertUrlShape(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return url;
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    reject("endpoint: el dominio no resuelve");
  }
  if (addrs.length === 0) reject("endpoint: el dominio no resuelve");
  if (addrs.some((a) => isBlockedIp(a.address))) {
    reject("endpoint resuelve a una dirección privada o reservada");
  }
  return url;
}
