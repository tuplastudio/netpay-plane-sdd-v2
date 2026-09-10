import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Almacenamiento del logo en disco local, servido estáticamente por el API en
 * `/uploads/<key>` (ver `main.ts`). El repo no trae cliente S3 ni servicio de
 * objetos, así que esta es la opción que ya soporta la infraestructura; el
 * `key` sigue la convención `tenants/<tenantId>/logo-<hash>.<ext>` para que
 * migrar a MinIO/S3 sea cambiar solo este módulo.
 */

export const UPLOADS_ROUTE = "/uploads";

export function uploadsDir(): string {
  const configured = process.env.UPLOADS_DIR;
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), "uploads");
}

/**
 * Base pública del API para armar URLs absolutas (el logo se guarda como URL
 * completa porque lo consumen el PDF, la página pública y el agente).
 * Orden: `API_PUBLIC_URL` → `COMMERCE_API_URL` sin `/api/v1` → localhost.
 */
export function apiPublicBaseUrl(): string {
  const explicit = process.env.API_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const commerce = process.env.COMMERCE_API_URL?.trim();
  if (commerce) return commerce.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `http://localhost:${process.env.API_PORT ?? 4000}`;
}

export function publicUrlForKey(key: string): string {
  return `${apiPublicBaseUrl()}${UPLOADS_ROUTE}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Key relativo si la URL apunta a nuestro `/uploads/`; `null` si es externa. */
export function keyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const prefix = `${UPLOADS_ROUTE}/`;
    if (!u.pathname.startsWith(prefix)) return null;
    const key = decodeURIComponent(u.pathname.slice(prefix.length));
    return isSafeKey(key) ? key : null;
  } catch {
    return null;
  }
}

function isSafeKey(key: string): boolean {
  if (!key || key.includes("\\") || key.includes("\0")) return false;
  const parts = key.split("/");
  return parts.every((p) => p.length > 0 && p !== "." && p !== "..");
}

export function localPathForKey(key: string): string {
  if (!isSafeKey(key)) throw new Error(`Key de almacenamiento inválido: ${key}`);
  const root = uploadsDir();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error(`Key fuera del directorio de uploads: ${key}`);
  return full;
}

export async function writeObject(key: string, bytes: Buffer): Promise<void> {
  const full = localPathForKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await fs.unlink(localPathForKey(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function readObject(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPathForKey(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
