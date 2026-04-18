import { getPool, markInMemoryFallback, shouldUseInMemoryStore } from "@/lib/persistence";

export type AuditStatus =
  | "success"
  | "unauthorized"
  | "validation_error"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "error";

type AuditEventInput = {
  endpoint: string;
  action: string;
  actorAddress?: string | null;
  ip?: string | null;
  status: AuditStatus;
  resourceId?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AuditLogRow = {
  id: string;
  endpoint: string;
  action: string;
  actorAddress: string | null;
  ip: string | null;
  status: AuditStatus;
  resourceId: string | null;
  message: string | null;
  metadata: string | null;
  createdAt: string;
};

type DbAuditLogRow = {
  id: string;
  endpoint: string;
  action: string;
  actor_address: string | null;
  ip: string | null;
  status: AuditStatus;
  resource_id: string | null;
  message: string | null;
  metadata: string | null;
  created_at: string;
};

const auditLogs: AuditLogRow[] = [];
let schemaReady: Promise<void> | null = null;
const AUDIT_RETENTION_DAYS = 30;

async function ensureSchema(): Promise<void> {
  if (shouldUseInMemoryStore()) {
    return;
  }
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            endpoint TEXT NOT NULL,
            action TEXT NOT NULL,
            actor_address TEXT,
            ip TEXT,
            status TEXT NOT NULL,
            resource_id TEXT,
            message TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL
          )
        `);
      } finally {
        client.release();
      }
    })();
  }
  await schemaReady;
}

export function logAuditEvent(event: AuditEventInput): void {
  const row: AuditLogRow = {
    id: crypto.randomUUID(),
    endpoint: event.endpoint,
    action: event.action,
    actorAddress: event.actorAddress ?? null,
    ip: event.ip ?? null,
    status: event.status,
    resourceId: event.resourceId ?? null,
    message: event.message ?? null,
    metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    createdAt: new Date().toISOString(),
  };
  auditLogs.unshift(row);

  if (shouldUseInMemoryStore()) {
    return;
  }
  void (async () => {
    try {
      await ensureSchema();
      await getPool().query(
        `
          INSERT INTO audit_logs (
            id, endpoint, action, actor_address, ip, status, resource_id, message, metadata, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          row.id,
          row.endpoint,
          row.action,
          row.actorAddress,
          row.ip,
          row.status,
          row.resourceId,
          row.message,
          row.metadata,
          row.createdAt,
        ]
      );
      const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await getPool().query("DELETE FROM audit_logs WHERE created_at < $1", [cutoff]);
    } catch (error) {
      markInMemoryFallback(error);
    }
  })();
}

export function clearAuditLogs(): void {
  auditLogs.length = 0;
  if (shouldUseInMemoryStore()) {
    return;
  }
  void (async () => {
    try {
      await ensureSchema();
      await getPool().query("DELETE FROM audit_logs");
    } catch (error) {
      markInMemoryFallback(error);
    }
  })();
}

export function listAuditLogs(limit = 100): Array<AuditLogRow & { parsedMetadata: Record<string, unknown> | null }> {
  return auditLogs.slice(0, limit).map((row) => ({
    ...row,
    parsedMetadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
  }));
}

function mapDbRow(row: DbAuditLogRow): AuditLogRow {
  return {
    id: row.id,
    endpoint: row.endpoint,
    action: row.action,
    actorAddress: row.actor_address,
    ip: row.ip,
    status: row.status,
    resourceId: row.resource_id,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function listAuditLogsDurable(
  limit = 100,
  actorAddress?: string
): Promise<Array<AuditLogRow & { parsedMetadata: Record<string, unknown> | null }>> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  if (shouldUseInMemoryStore()) {
    return listAuditLogs(safeLimit);
  }

  try {
    await ensureSchema();
    const args: unknown[] = [];
    let where = "";
    if (actorAddress) {
      where = "WHERE lower(actor_address) = lower($1)";
      args.push(actorAddress);
      args.push(safeLimit);
    } else {
      args.push(safeLimit);
    }
    const limitPlaceholder = actorAddress ? "$2" : "$1";
    const query = `
      SELECT id, endpoint, action, actor_address, ip, status, resource_id, message, metadata, created_at
      FROM audit_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limitPlaceholder}
    `;
    const result = await getPool().query<DbAuditLogRow>(query, args);
    return result.rows.map((row) => {
      const mapped = mapDbRow(row);
      return {
        ...mapped,
        parsedMetadata: mapped.metadata ? JSON.parse(mapped.metadata) as Record<string, unknown> : null,
      };
    });
  } catch (error) {
    markInMemoryFallback(error);
    if (actorAddress) {
      return listAuditLogs(safeLimit).filter((row) =>
        row.actorAddress?.toLowerCase() === actorAddress.toLowerCase()
      );
    }
    return listAuditLogs(safeLimit);
  }
}
