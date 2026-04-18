import { getPool, markInMemoryFallback, shouldUseInMemoryStore } from "@/lib/persistence";

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type NonceRecord = {
  address: string;
  expiresAt: number;
};

type SessionRecord = {
  address: string;
  expiresAt: number;
};

const nonces = new Map<string, NonceRecord>();
const sessions = new Map<string, SessionRecord>();
let schemaReady: Promise<void> | null = null;

function now(): number {
  return Date.now();
}

async function ensureSchema(): Promise<void> {
  if (shouldUseInMemoryStore()) {
    return;
  }
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS auth_nonces (
            nonce TEXT PRIMARY KEY,
            address TEXT NOT NULL,
            expires_at BIGINT NOT NULL
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            address TEXT NOT NULL,
            expires_at BIGINT NOT NULL
          )
        `);
      } finally {
        client.release();
      }
    })();
  }
  await schemaReady;
}

function purgeExpiredNoncesInMemory(): void {
  const ts = now();
  for (const [nonce, record] of nonces) {
    if (record.expiresAt < ts) {
      nonces.delete(nonce);
    }
  }
}

function purgeExpiredSessionsInMemory(): void {
  const ts = now();
  for (const [token, record] of sessions) {
    if (record.expiresAt < ts) {
      sessions.delete(token);
    }
  }
}

export async function issueNonce(address: string): Promise<string> {
  const nonce = crypto.randomUUID();
  if (shouldUseInMemoryStore()) {
    nonces.set(nonce, {
      address,
      expiresAt: now() + NONCE_TTL_MS,
    });
    return nonce;
  }

  try {
    await ensureSchema();
    await getPool().query(
      "INSERT INTO auth_nonces (nonce, address, expires_at) VALUES ($1, $2, $3)",
      [nonce, address, now() + NONCE_TTL_MS]
    );
    return nonce;
  } catch (error) {
    markInMemoryFallback(error);
    nonces.set(nonce, {
      address,
      expiresAt: now() + NONCE_TTL_MS,
    });
    return nonce;
  }
}

export async function hasNonce(address: string, nonce: string): Promise<boolean> {
  if (shouldUseInMemoryStore()) {
    purgeExpiredNoncesInMemory();
    const record = nonces.get(nonce);
    if (!record) {
      return false;
    }
    return record.address.toLowerCase() === address.toLowerCase();
  }

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM auth_nonces WHERE expires_at < $1", [now()]);
    const result = await getPool().query<{ address: string }>(
      "SELECT address FROM auth_nonces WHERE nonce = $1 LIMIT 1",
      [nonce]
    );
    const row = result.rows[0];
    if (!row) {
      return false;
    }
    return row.address.toLowerCase() === address.toLowerCase();
  } catch (error) {
    markInMemoryFallback(error);
    purgeExpiredNoncesInMemory();
    const record = nonces.get(nonce);
    if (!record) {
      return false;
    }
    return record.address.toLowerCase() === address.toLowerCase();
  }
}

export async function consumeNonce(address: string, nonce: string): Promise<boolean> {
  if (!(await hasNonce(address, nonce))) {
    return false;
  }

  if (shouldUseInMemoryStore()) {
    nonces.delete(nonce);
    return true;
  }

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM auth_nonces WHERE nonce = $1", [nonce]);
    return true;
  } catch (error) {
    markInMemoryFallback(error);
    nonces.delete(nonce);
    return true;
  }
}

export async function createSession(address: string): Promise<string> {
  const token = crypto.randomUUID();
  if (shouldUseInMemoryStore()) {
    sessions.set(token, {
      address,
      expiresAt: now() + SESSION_TTL_MS,
    });
    return token;
  }

  try {
    await ensureSchema();
    await getPool().query(
      "INSERT INTO auth_sessions (token, address, expires_at) VALUES ($1, $2, $3)",
      [token, address, now() + SESSION_TTL_MS]
    );
    return token;
  } catch (error) {
    markInMemoryFallback(error);
    sessions.set(token, {
      address,
      expiresAt: now() + SESSION_TTL_MS,
    });
    return token;
  }
}

export async function getSessionAddress(token: string): Promise<string | null> {
  if (shouldUseInMemoryStore()) {
    purgeExpiredSessionsInMemory();
    const record = sessions.get(token);
    return record?.address ?? null;
  }

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM auth_sessions WHERE expires_at < $1", [now()]);
    const result = await getPool().query<{ address: string }>(
      "SELECT address FROM auth_sessions WHERE token = $1 LIMIT 1",
      [token]
    );
    const row = result.rows[0];
    return row?.address ?? null;
  } catch (error) {
    markInMemoryFallback(error);
    purgeExpiredSessionsInMemory();
    const record = sessions.get(token);
    return record?.address ?? null;
  }
}

export async function invalidateSession(token: string): Promise<void> {
  if (shouldUseInMemoryStore()) {
    sessions.delete(token);
    return;
  }

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM auth_sessions WHERE token = $1", [token]);
  } catch (error) {
    markInMemoryFallback(error);
    sessions.delete(token);
  }
}

export async function clearAuthState(): Promise<void> {
  nonces.clear();
  sessions.clear();
  if (shouldUseInMemoryStore()) {
    return;
  }

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM auth_nonces");
    await getPool().query("DELETE FROM auth_sessions");
  } catch (error) {
    markInMemoryFallback(error);
  }
}
