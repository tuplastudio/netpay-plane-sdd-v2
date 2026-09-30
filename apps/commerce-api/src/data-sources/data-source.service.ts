/**
 * Fuentes de datos (sync de catálogo desde API REST / servidor MCP).
 * Ver docs/integrations/data-sources.md.
 *
 * Responsabilidades: CRUD con credencial cifrada, prueba de conexión con
 * vista previa, ejecución de sincronizaciones (manual o por scheduler) con
 * lock por fuente, e historial de runs.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RequestContext } from "../common/context/request-context.js";
import { decryptSecret, encryptSecret } from "../common/crypto/secret-cipher.js";
import { assertPublicHttpUrl } from "../integrations/url-guard.js";
import {
  DataSourceConfig,
  DataSourceKind,
  McpConfig,
  RestConfig,
  parseDataSourceConfig,
} from "./data-source-config.js";
import {
  CreateDataSourceDto,
  ListToolsDto,
  TestDataSourceDto,
  UpdateDataSourceDto,
} from "./data-source.dto.js";
import { MapResult, extractItems, mapItem } from "./field-map.js";
import { ConnectionAuth, DataSourceAuthType, HttpOptions } from "./http-client.js";
import { McpClient, McpTool, decodeToolResult } from "./mcp-client.js";
import { fetchRestItems } from "./rest-client.js";
import { LOCK_TTL_MS, computeNextRun, isValidCron } from "./schedule.js";
import { SyncError, SyncStats, syncItems } from "./sync-engine.js";

/** Lo que sale por el API. `credentialEnc` nunca. */
export const DATA_SOURCE_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  kind: true,
  status: true,
  url: true,
  authType: true,
  authHeaderName: true,
  headers: true,
  config: true,
  scheduleEveryMinutes: true,
  scheduleCron: true,
  deactivateMissing: true,
  nextRunAt: true,
  lastRunAt: true,
  lastStatus: true,
  lastError: true,
  lockedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Ítems que se traen en la prueba de conexión y cuántos se muestran. */
const TEST_FETCH_LIMIT = 20;
const TEST_PREVIEW_SIZE = 3;
const MAX_EXTRA_HEADERS = 20;
const RUNS_PAGE_SIZE = 50;

export interface TestResult {
  ok: boolean;
  fetched: number;
  rawSample: unknown[];
  preview: MapResult[];
  /** Solo MCP: tools disponibles, para elegir `toolName` en el asistente. */
  tools?: McpTool[];
}

export type Trigger = "MANUAL" | "SCHEDULE";

interface SourceRow {
  id: string;
  tenantId: string;
  name: string;
  kind: DataSourceKind;
  status: string;
  url: string;
  authType: DataSourceAuthType;
  credentialEnc: string | null;
  authHeaderName: string | null;
  headers: unknown;
  config: unknown;
  scheduleEveryMinutes: number | null;
  scheduleCron: string | null;
  deactivateMissing: boolean;
}

function sanitizeHeaders(raw: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_EXTRA_HEADERS) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: `Máximo ${MAX_EXTRA_HEADERS} headers` });
  }
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9-]+$/.test(key)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: `Header "${key}" inválido` });
    }
    if (typeof value !== "string" || value.length > 2000 || /[\r\n]/.test(value)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: `Valor del header "${key}" inválido` });
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function validateSchedule(input: { scheduleEveryMinutes?: number | null; scheduleCron?: string | null }) {
  const cron = input.scheduleCron?.trim() || null;
  if (cron && !isValidCron(cron)) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: "scheduleCron inválido (5 campos)" });
  }
  return { scheduleCron: cron, scheduleEveryMinutes: input.scheduleEveryMinutes ?? null };
}

@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- CRUD

  async list(tenantId: string) {
    return this.prisma.dataSource.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: DATA_SOURCE_PUBLIC_SELECT,
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.dataSource.findFirst({
      where: { id, tenantId },
      select: DATA_SOURCE_PUBLIC_SELECT,
    });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Fuente de datos no accesible" });
    return row;
  }

  private async loadRow(tenantId: string, id: string): Promise<SourceRow> {
    const row = await this.prisma.dataSource.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Fuente de datos no accesible" });
    return row as unknown as SourceRow;
  }

  async create(tenantId: string, actorId: string | null, input: CreateDataSourceDto) {
    await assertPublicHttpUrl(input.url);
    const config = parseDataSourceConfig(input.kind, input.config);
    const headers = sanitizeHeaders(input.headers);
    const schedule = validateSchedule(input);
    const authType = input.authType ?? "NONE";
    const status = input.status ?? "ACTIVE";
    const nextRunAt = status === "ACTIVE" ? computeNextRun(schedule, new Date()) : null;

    const row = await this.prisma.dataSource.create({
      data: {
        tenantId,
        name: input.name.trim(),
        kind: input.kind,
        status,
        url: input.url.trim(),
        authType,
        credentialEnc: authType !== "NONE" && input.credential ? encryptSecret(input.credential) : null,
        authHeaderName: authType === "API_KEY_HEADER" ? (input.authHeaderName ?? "X-API-Key") : null,
        headers: headers ?? undefined,
        config: config as never,
        scheduleEveryMinutes: schedule.scheduleEveryMinutes,
        scheduleCron: schedule.scheduleCron,
        deactivateMissing: input.deactivateMissing ?? false,
        nextRunAt,
        createdById: actorId,
      },
      select: DATA_SOURCE_PUBLIC_SELECT,
    });
    await this.audit(tenantId, actorId, "data_source.created", row.id, { name: row.name, kind: row.kind });
    return row;
  }

  async update(tenantId: string, actorId: string | null, id: string, input: UpdateDataSourceDto) {
    const existing = await this.loadRow(tenantId, id);
    if (input.url !== undefined) await assertPublicHttpUrl(input.url);
    const config = input.config !== undefined ? parseDataSourceConfig(existing.kind, input.config) : undefined;
    const headers = input.headers === undefined ? undefined : sanitizeHeaders(input.headers);
    const schedule = validateSchedule({
      scheduleEveryMinutes:
        input.scheduleEveryMinutes === undefined ? existing.scheduleEveryMinutes : input.scheduleEveryMinutes,
      scheduleCron: input.scheduleCron === undefined ? existing.scheduleCron : input.scheduleCron,
    });
    const authType = input.authType ?? existing.authType;
    const status = input.status ?? (existing.status === "PAUSED" ? "PAUSED" : "ACTIVE");

    let credentialEnc: string | null | undefined;
    if (authType === "NONE") credentialEnc = null;
    else if (input.credential !== undefined) credentialEnc = input.credential ? encryptSecret(input.credential) : null;

    const row = await this.prisma.dataSource.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        url: input.url?.trim(),
        authType,
        credentialEnc,
        authHeaderName:
          authType === "API_KEY_HEADER"
            ? (input.authHeaderName ?? existing.authHeaderName ?? "X-API-Key")
            : null,
        headers: headers === undefined ? undefined : (headers ?? null) as never,
        config: config as never,
        scheduleEveryMinutes: schedule.scheduleEveryMinutes,
        scheduleCron: schedule.scheduleCron,
        deactivateMissing: input.deactivateMissing,
        status,
        nextRunAt: status === "ACTIVE" ? computeNextRun(schedule, new Date()) : null,
        // Al reactivar se limpia el último error para no arrastrarlo.
        lastError: input.status === "ACTIVE" ? null : undefined,
      },
      select: DATA_SOURCE_PUBLIC_SELECT,
    });
    await this.audit(tenantId, actorId, "data_source.updated", id, {
      fields: Object.keys(input).filter((k) => k !== "credential"),
      credentialChanged: input.credential !== undefined,
    });
    return row;
  }

  /** Borra la fuente y su historial. Los productos importados se conservan. */
  async remove(tenantId: string, actorId: string | null, id: string) {
    const existing = await this.loadRow(tenantId, id);
    await this.prisma.dataSource.delete({ where: { id: existing.id } });
    await this.audit(tenantId, actorId, "data_source.deleted", id, { name: existing.name });
  }

  async listRuns(tenantId: string, id: string) {
    await this.loadRow(tenantId, id);
    return this.prisma.dataSourceRun.findMany({
      where: { tenantId, dataSourceId: id },
      orderBy: { startedAt: "desc" },
      take: RUNS_PAGE_SIZE,
    });
  }

  // ------------------------------------------------------------ conexión

  private connectionAuth(row: {
    authType: DataSourceAuthType;
    credentialEnc: string | null;
    authHeaderName: string | null;
    headers: unknown;
  }): ConnectionAuth {
    return {
      authType: row.authType,
      credential: row.credentialEnc ? decryptSecret(row.credentialEnc) : null,
      authHeaderName: row.authHeaderName,
      headers: (row.headers as Record<string, string> | null) ?? null,
    };
  }

  /** Arma la conexión de un cuerpo ad-hoc, tomando la credencial guardada si no viene. */
  private async adHocAuth(
    tenantId: string,
    input: { id?: string; authType?: DataSourceAuthType; credential?: string; authHeaderName?: string; headers?: Record<string, string> },
  ): Promise<ConnectionAuth> {
    const authType = input.authType ?? "NONE";
    let credential = input.credential ?? null;
    if (authType !== "NONE" && !credential && input.id) {
      const saved = await this.loadRow(tenantId, input.id);
      credential = saved.credentialEnc ? decryptSecret(saved.credentialEnc) : null;
    }
    return {
      authType,
      credential,
      authHeaderName: input.authHeaderName ?? null,
      headers: sanitizeHeaders(input.headers),
    };
  }

  private async fetchItems(
    kind: DataSourceKind,
    url: string,
    auth: ConnectionAuth,
    config: DataSourceConfig,
    limits: { maxItems?: number; maxPages?: number },
    http: HttpOptions = {},
  ): Promise<unknown[]> {
    if (kind === "REST") {
      const result = await fetchRestItems({ baseUrl: url, auth }, config as RestConfig, { ...http, ...limits });
      return result.items;
    }
    const mcp = config as McpConfig;
    const client = new McpClient(url, auth, http);
    const raw = decodeToolResult(await client.callTool(mcp.toolName, mcp.toolArgs ?? {}));
    const items = extractItems(raw, mcp.itemsJsonPath);
    const cap = limits.maxItems ?? mcp.maxItems;
    return cap ? items.slice(0, cap) : items;
  }

  /** Prueba ad-hoc (asistente) o de una fuente guardada. No escribe nada. */
  async test(tenantId: string, input: TestDataSourceDto, http: HttpOptions = {}): Promise<TestResult> {
    await assertPublicHttpUrl(input.url);
    const config = parseDataSourceConfig(input.kind, input.config);
    const auth = await this.adHocAuth(tenantId, input);
    return this.runTest(input.kind, input.url, auth, config, http);
  }

  async testSaved(tenantId: string, id: string, http: HttpOptions = {}): Promise<TestResult> {
    const row = await this.loadRow(tenantId, id);
    const config = parseDataSourceConfig(row.kind, row.config);
    return this.runTest(row.kind, row.url, this.connectionAuth(row), config, http);
  }

  private async runTest(
    kind: DataSourceKind,
    url: string,
    auth: ConnectionAuth,
    config: DataSourceConfig,
    http: HttpOptions,
  ): Promise<TestResult> {
    const items = await this.fetchItems(kind, url, auth, config, { maxItems: TEST_FETCH_LIMIT, maxPages: 1 }, http);
    const sample = items.slice(0, TEST_PREVIEW_SIZE);
    const result: TestResult = {
      ok: true,
      fetched: items.length,
      rawSample: sample,
      preview: sample.map((raw) => mapItem(raw, config.fieldMap)),
    };
    if (kind === "MCP") {
      result.tools = await new McpClient(url, auth, http).listTools();
    }
    return result;
  }

  /** Tools de un servidor MCP (ad-hoc, para el asistente). */
  async listTools(tenantId: string, input: ListToolsDto, http: HttpOptions = {}): Promise<McpTool[]> {
    await assertPublicHttpUrl(input.url);
    const auth = await this.adHocAuth(tenantId, input);
    return new McpClient(input.url, auth, http).listTools();
  }

  async listToolsSaved(tenantId: string, id: string, http: HttpOptions = {}): Promise<McpTool[]> {
    const row = await this.loadRow(tenantId, id);
    if (row.kind !== "MCP") {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "Solo las fuentes MCP exponen tools" });
    }
    return new McpClient(row.url, this.connectionAuth(row), http).listTools();
  }

  // ---------------------------------------------------------------- sync

  /**
   * Toma el lock de la fuente. Devuelve false si otro run la tiene (lock
   * vigente). Es un `updateMany` condicional: atómico aunque haya varias
   * réplicas del API corriendo el scheduler.
   */
  private async claimLock(id: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.dataSource.updateMany({
      where: {
        id,
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) } }],
      },
      data: { lockedAt: now },
    });
    return count === 1;
  }

  /**
   * Crea el run y lanza la sincronización en segundo plano. Devuelve el id
   * del run para que el panel lo consulte. 409 si ya hay una en curso.
   */
  async triggerSync(
    tenantId: string,
    id: string,
    triggeredBy: Trigger,
    actorId: string | null,
    http: HttpOptions = {},
  ): Promise<{ runId: string }> {
    const row = await this.loadRow(tenantId, id);
    const now = new Date();
    if (!(await this.claimLock(row.id, now))) {
      throw new ConflictException({ code: "CONFLICT", message: "Ya hay una sincronización en curso" });
    }
    const run = await this.prisma.dataSourceRun.create({
      data: { tenantId, dataSourceId: row.id, triggeredBy, triggeredById: actorId, status: "RUNNING" },
      select: { id: true },
    });
    if (triggeredBy === "MANUAL") {
      await this.audit(tenantId, actorId, "data_source.sync_requested", id, { runId: run.id });
    }
    void this.executeRun(row, run.id, http).catch((err) => {
      this.logger.error(`Run ${run.id} falló fuera del flujo: ${(err as Error).message}`);
    });
    return { runId: run.id };
  }

  /** Ejecuta un run ya creado (lock tomado). Siempre cierra el run y suelta el lock. */
  async executeRun(row: SourceRow, runId: string, http: HttpOptions = {}): Promise<void> {
    let stats: SyncStats | null = null;
    let errors: SyncError[] = [];
    let fatal: string | null = null;
    try {
      const config = parseDataSourceConfig(row.kind, row.config);
      const items = await this.fetchItems(row.kind, row.url, this.connectionAuth(row), config, {}, http);
      const outcome = await syncItems(
        this.prisma,
        { id: row.id, tenantId: row.tenantId, deactivateMissing: row.deactivateMissing },
        items,
        config.fieldMap,
      );
      stats = outcome.stats;
      errors = outcome.errors;
    } catch (err) {
      fatal = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }

    const finishedAt = new Date();
    const status = fatal ? "FAILED" : stats && stats.errors > 0 ? "PARTIAL" : "SUCCEEDED";
    await this.prisma.dataSourceRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt,
        stats: stats as never,
        errorSample: (fatal ? [{ message: fatal }, ...errors] : errors) as never,
      },
    });
    await this.prisma.dataSource.update({
      where: { id: row.id },
      data: {
        lockedAt: null,
        lastRunAt: finishedAt,
        lastStatus: status,
        lastError: fatal ?? (errors[0]?.message ?? null),
        status: fatal ? "ERROR" : row.status === "ERROR" ? "ACTIVE" : undefined,
        nextRunAt:
          row.status === "PAUSED"
            ? null
            : computeNextRun(
                { scheduleEveryMinutes: row.scheduleEveryMinutes, scheduleCron: row.scheduleCron },
                finishedAt,
              ),
      },
    });
    await this.audit(row.tenantId, null, "data_source.sync_finished", row.id, {
      runId,
      status,
      ...(stats ?? {}),
      ...(fatal ? { error: fatal } : {}),
    });
    this.logger.log(`Fuente ${row.id} (${row.name}): run ${runId} ${status}`);
  }

  /** Fuentes cuya programación venció. Lo usa el scheduler. */
  async findDue(now: Date, limit = 20) {
    return this.prisma.dataSource.findMany({
      where: {
        status: { in: ["ACTIVE", "ERROR"] },
        nextRunAt: { lte: now },
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) } }],
      },
      orderBy: { nextRunAt: "asc" },
      take: limit,
      select: { id: true, tenantId: true },
    });
  }

  private async audit(
    tenantId: string,
    actorId: string | null,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actorId ?? RequestContext.userId ?? null,
        action,
        targetType: "DataSource",
        targetId,
        metadata: metadata as never,
      },
    });
  }
}
