import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { supabaseAdmin } from '@/services/supabaseClient';
import whalesFallback from '../../whales_cache.json';

const trepa = new Trepa({ credentials: credentialsFromEnv() });

// Thin wrapper — audit_logs table was never created so we call fn() directly.
async function withAudit<T>(
  _name: string,
  _method: string,
  fn: () => Promise<T>,
  _payload?: any
): Promise<T> {
  return fn();
}

// Cache for user precision scores to minimize API calls
const scoreCache = new Map<string, number>();

/**
 * Returns true when the Trepa API returned a Cloudflare "Access Restricted" HTML page
 * instead of JSON. This happens when the calling IP (Vercel datacenter) is blocked.
 * We detect it by checking for HTML markers in the error message or response body.
 */
export function isCloudflareBlock(err: any): boolean {
  const text = [
    err?.message,
    err?.body,
    typeof err === 'string' ? err : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    text.includes('Access Restricted') ||
    text.includes('access restricted') ||
    text.includes('<!doctype') ||
    text.includes('<html') ||
    text.includes('cloudflare') ||
    // SDK JSON-parse failure when it receives HTML instead of JSON
    (text.includes('Unexpected token') && text.includes('<'))
  );
}

export function getPool(poolId: string) {
  return withAudit('pools.get', 'GET', () => trepa.pools.get(poolId), { poolId });
}

export function getNextSessionTime(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 0, 0, 0));
  if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// In-memory cache — useful on warm serverless instances (Vercel reuses warm Lambdas)
let cachedActivePool: any = null;
let lastPoolFetch = 0;
const POOL_CACHE_TTL = 30_000;

/**
 * Fetches the current active Bitcoin pool from the Trepa SDK.
 *
 * IMPORTANT: Vercel (and GitHub Actions) run on datacenter IPs that Cloudflare
 * blocks for trepa.io. This function should ONLY be called from GitHub Actions
 * (bot_predict.ts). Vercel routes must read from Supabase cache instead.
 *
 * If a Cloudflare block is detected the error is re-thrown with a clear message.
 */
export async function getActiveBitcoinPool() {
  const nowMs = Date.now();
  if (cachedActivePool && (nowMs - lastPoolFetch) < POOL_CACHE_TTL) {
    return cachedActivePool;
  }

  try {
    const bitcoinStreak = await trepa.streaks.bitcoin();
    if (!bitcoinStreak?.id) {
      const fallback = { pool: null, expertCount: 0 };
      cachedActivePool = fallback;
      lastPoolFetch = Date.now();
      await supabaseAdmin.from('pool_cache').upsert({ id: 1, pool: null, updated_at: new Date().toISOString() });
      return fallback;
    }

    const activePools: any[] = await trepa.pools.list({
      filter_by: ['ACTIVE'] as any,
      streak_id: bitcoinStreak.id,
      limit: 1,
    } as any);

    let pool: any = Array.isArray(activePools) && activePools.length > 0
      ? activePools[0]
      : null;

    // Fallback: poolDetails current_pool (catches Watch Phase pools)
    if (!pool) {
      const details = await trepa.streaks.poolDetails(bitcoinStreak.id);
      if (details?.current_pool && !details.current_pool.is_closed) {
        pool = details.current_pool;
      }
    }

    // Expert count — non-critical, never throws
    let expertCount = 0;
    if (pool) {
      const predictionWindowOpen = pool.prediction_end_date && new Date() < new Date(pool.prediction_end_date);
      if (predictionWindowOpen) {
        try {
          const predictions: any[] = await trepa.pools.predictions(pool.id, { limit: 50 });
          expertCount = Array.isArray(predictions) ? predictions.length : 0;
        } catch { /* non-critical */ }
      }
    }

    const result = { pool: pool ?? null, expertCount };
    cachedActivePool = result;
    lastPoolFetch = Date.now();

    // Always write to Supabase (even null) so cache timestamp stays fresh
    await supabaseAdmin.from('pool_cache').upsert({ id: 1, pool: pool ?? null, updated_at: new Date().toISOString() });

    return result;
  } catch (err: any) {
    if (isCloudflareBlock(err)) {
      throw new Error('TREPA_IP_BLOCKED: Trepa/Cloudflare is blocking this server\'s IP address. Predictions must run from GitHub Actions, not from Vercel.');
    }
    throw err;
  }
}

export async function getPrecisionScore(userId: string): Promise<number> {
  if (scoreCache.has(userId)) return scoreCache.get(userId)!;
  try {
    const stats: any = await withAudit('users.statistics', 'GET', () => trepa.users.statistics(userId), { userId });
    const score = stats?.precision_score ??
                 stats?.precisionScore ??
                 stats?.average_precision_score ??
                 stats?.averagePrecisionScore ??
                 stats?.score ?? 0;
    const finalScore = Number(score) || 0;
    scoreCache.set(userId, finalScore);
    return finalScore;
  } catch (error) {
    console.error(`Error fetching precision score for ${userId}:`, error);
    scoreCache.set(userId, 0);
    return 0;
  }
}

export async function getHallOfFame() {
  try {
    const { data, error } = await supabaseAdmin
      .from('whales_cache')
      .select('data')
      .eq('id', 1)
      .single();
    if (!error && data?.data && Array.isArray(data.data) && data.data.length > 0) {
      return data.data;
    }
    return Array.isArray(whalesFallback) ? whalesFallback : [];
  } catch {
    return Array.isArray(whalesFallback) ? whalesFallback : [];
  }
}

export async function mirrorForecast(poolId: string, myUserId?: string) {
  let predictions: any[] = [];
  try {
    const res: any = await trepa.pools.predictions(poolId, { limit: 20, includes: ['user'] });
    predictions = Array.isArray(res) ? res : (res?.data || []);
  } catch (error) {
    console.error(`Error in mirrorForecast for pool ${poolId}:`, error);
    return { prediction: null, topPredictors: [] };
  }

  const others = predictions.filter(p => {
    const uid = p?.user?.id ?? p?.predictor_account;
    return uid && uid !== myUserId;
  });
  if (others.length === 0) return { prediction: null, topPredictors: [] };

  const uniqueByUser = new Map<string, any>();
  for (const p of others) {
    const uid = p?.user?.id ?? p?.predictor_account;
    if (!uid) continue;
    const existing = uniqueByUser.get(uid);
    const pDate = p.updated_at ? new Date(p.updated_at) : new Date(0);
    const eDate = existing?.updated_at ? new Date(existing.updated_at) : new Date(0);
    if (!existing || pDate > eDate) uniqueByUser.set(uid, p);
  }

  const scored = await Promise.all(
    [...uniqueByUser.entries()].map(async ([uid, p]) => {
      const value = Number(p.prediction ?? p.value);
      const score = await getPrecisionScore(uid);
      return {
        uid,
        username: p.user?.username ?? `anon-${uid.slice(0, 4)}`,
        value: isNaN(value) ? 0 : value,
        score
      };
    })
  );

  const TOP_N = 5;
  const top = scored.filter(x => x.value > 0).sort((a, b) => b.score - a.score).slice(0, TOP_N);
  if (top.length === 0) return { prediction: null, topPredictors: [] };

  const totalScore = top.reduce((s, x) => s + x.score, 0);
  const prediction = totalScore > 0
    ? top.reduce((s, x) => s + x.value * x.score, 0) / totalScore
    : top.reduce((s, x) => s + x.value, 0) / top.length;

  return {
    prediction,
    topPredictors: top.map(t => ({ username: t.username, score: t.score, forecast: t.value }))
  };
}

export { trepa };
