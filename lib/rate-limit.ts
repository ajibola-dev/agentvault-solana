import { getPool, markInMemoryFallback, shouldUseInMemoryStore } from "@/lib/persistence";

type RateLimitParams = {
  endpoint: string;
  key: string;
  max: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const counters = new Map<string, number>();
let schemaReady: Promise<void> | null = null;

function now(): number {
  return Date.now();
}

function makeBucketKey(endpoint: string, key: string, windowStart: number): string {
  return `${endpoint}|${key}|${windowStart}`;
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
          CREATE TABLE IF NOT EXISTS rate_limits (
            endpoint TEXT NOT NULL,
            key TEXT NOT NULL,
            window_start BIGINT NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY (endpoint, key, window_start)
          )
        `);
      } finally {
        client.release();
      }
    })();
  }
  await schemaReady;
}

function checkRateLimitInMemory(params: RateLimitParams): RateLimitResult {
  const ts = now();
  const windowStart = Math.floor(ts / params.windowMs) * params.windowMs;
  const minWindowStart = windowStart - params.windowMs * 2;

  for (const bucketKey of counters.keys()) {
    const parts = bucketKey.split("|");
    const bucketWindowStart = Number(parts[parts.length - 1]);
    if (Number.isFinite(bucketWindowStart) && bucketWindowStart < minWindowStart) {
      counters.delete(bucketKey);
    }
  }

  const bucketKey = makeBucketKey(params.endpoint, params.key, windowStart);
  const nextCount = (counters.get(bucketKey) ?? 0) + 1;
  counters.set(bucketKey, nextCount);

  const remaining = Math.max(0, params.max - nextCount);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + params.windowMs - ts) / 1000));

  return {
    allowed: nextCount <= params.max,
    remaining,
    retryAfterSeconds,
  };
}

export async function checkRateLimit(params: RateLimitParams): Promise<RateLimitResult> {
  if (shouldUseInMemoryStore()) {
    return checkRateLimitInMemory(params);
  }

  const ts = now();
  const windowStart = Math.floor(ts / params.windowMs) * params.windowMs;
  const minWindowStart = windowStart - params.windowMs * 2;

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM rate_limits WHERE window_start < $1", [minWindowStart]);
    await getPool().query(
      `
        INSERT INTO rate_limits (endpoint, key, window_start, count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT(endpoint, key, window_start)
        DO UPDATE SET count = rate_limits.count + 1
      `,
      [params.endpoint, params.key, windowStart]
    );

    const result = await getPool().query<{ count: number }>(
      "SELECT count FROM rate_limits WHERE endpoint = $1 AND key = $2 AND window_start = $3 LIMIT 1",
      [params.endpoint, params.key, windowStart]
    );
    const count = result.rows[0]?.count ?? 0;
    const remaining = Math.max(0, params.max - count);
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + params.windowMs - ts) / 1000));

    return {
      allowed: count <= params.max,
      remaining,
      retryAfterSeconds,
    };
  } catch (error) {
    markInMemoryFallback(error);
    return checkRateLimitInMemory(params);
  }
}

export async function clearRateLimits(): Promise<void> {
  counters.clear();
  if (shouldUseInMemoryStore()) {
    return;
  }

  try {
    await ensureSchema();
    await getPool().query("DELETE FROM rate_limits");
  } catch (error) {
    markInMemoryFallback(error);
  }
}
