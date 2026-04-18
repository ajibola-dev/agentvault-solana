import { Pool } from "pg";

let pool: Pool | null = null;
let forceInMemory = false;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("DATABASE_URL (or POSTGRES_URL) is required");
  }
  return url.replace("sslmode=require", "sslmode=no-verify");
}

export function shouldUseInMemoryStore(): boolean {
  return process.env.NODE_ENV === "test" || forceInMemory;
}

function shouldFallbackToInMemory(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("self-signed certificate in certificate chain") ||
    message.includes("unable to verify the first certificate") ||
    message.includes("certificate has expired")
  );
}

export function markInMemoryFallback(error: unknown): void {
  if (!shouldFallbackToInMemory(error)) {
    return;
  }
  forceInMemory = true;
  pool = null;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}
