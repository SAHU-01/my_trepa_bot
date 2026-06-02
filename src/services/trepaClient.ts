import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { supabaseAdmin } from '@/services/supabaseClient';
import whalesFallback from '../../whales_cache.json';

// Initialize the Trepa SDK with credentials from environment variables
const trepa = new Trepa({ credentials: credentialsFromEnv() });

// Thin wrapper — just calls fn() directly. audit_logs table was never created
// so the previous logAudit() calls were causing 404 errors on every SDK call.
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
 * FORWARD-COMPATIBILITY ABSTRACTION:
 * This function handles fetching a pool.
 */
export async function getPool(poolId: string) {
  return await withAudit('pools.get', 'GET', () => trepa.pools.get(poolId), { poolId });
}

/**
 * Calculates the next session start time (13:00 UTC daily).
 */
export function getNextSessionTime(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 0, 0, 0));
  
  // If 13:00 UTC has already passed today, set to tomorrow
  if (now >= next) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  
  return next.toISOString();
}

// Cache for active pool to reduce sequential API hop latency
let cachedActivePool: any = null;
let lastPoolFetch = 0;
const POOL_CACHE_TTL = 3000; // 3 seconds

/**
 * Fetches the current active/watch-phase pool for the Bitcoin Flash streak.
 *
 * Strategy: `streaks.poolDetails().current_pool` is null when the pool is in
 * PREDICTIONS_FROZEN (Watch Phase). So we also check `next_pool` and fall back
 * to the most-recently-started pool from `streaks.pools()` that isn't closed.
 */
export async function getActiveBitcoinPool() {
  const nowMs = Date.now();
  if (cachedActivePool && (nowMs - lastPoolFetch) < POOL_CACHE_TTL) {
    return cachedActivePool;
  }

  try {
    const bitcoinStreak = await trepa.streaks.bitcoin();
    if (!bitcoinStreak?.id) return { pool: null, expertCount: 0 };

    // Use pools.list() with filter_by: ["ACTIVE"] — the correct API for live pools.
    // streaks.poolDetails().current_pool is unreliable (null during Watch Phase).
    // streaks.pools() returns historical pools, not filtered by active status.
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

    if (!pool) {
      const fallback = { pool: null, expertCount: 0 };
      cachedActivePool = fallback;
      lastPoolFetch = Date.now();
      return fallback;
    }

    // Expert count — only during open prediction window
    let expertCount = 0;
    const predictionWindowOpen = pool.prediction_end_date && new Date() < new Date(pool.prediction_end_date);
    if (predictionWindowOpen) {
      const predictions: any[] = await trepa.pools.predictions(pool.id, { limit: 50 });
      expertCount = Array.isArray(predictions) ? predictions.length : 0;
    }

    const result = { pool, expertCount };
    cachedActivePool = result;
    lastPoolFetch = Date.now();

    // Write to Supabase so /api/pools/active can read from cache instead of hitting Trepa directly
    await supabaseAdmin.from('pool_cache').upsert({ id: 1, pool: pool ?? null, updated_at: new Date().toISOString() });

    return result;
  } catch (error: any) {
    console.error('Error fetching active pool:', error?.message ?? error);
    return { pool: null, expertCount: 0 };
  }
}

/**
 * Fetches and caches a user's precision score.
 */
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

/**
 * Fetches the Hall of Fame from Supabase.
 * Data is populated by the /api/whale-sync Vercel Cron job (runs daily at 13:05 UTC).
 */
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
    // Supabase empty or errored — fall back to bundled snapshot
    return Array.isArray(whalesFallback) ? whalesFallback : [];
  } catch (err) {
    return Array.isArray(whalesFallback) ? whalesFallback : [];
  }
}

/**
 * Mirror Forecast Logic:
 * Fetches the top 5 predictors for a given pool and weights their predictions 
 * by their precision scores to generate a weighted average prediction.
 */
export async function mirrorForecast(poolId: string, myUserId?: string) {
  let predictions: any[] = [];
  try {
    // Use the new straightforward predictions endpoint from @trepa/sdk v0.2.x
    const res: any = await trepa.pools.predictions(poolId, { limit: 20, includes: ['user'] });
    predictions = Array.isArray(res) ? res : (res?.data || []);
  } catch (error) {
    console.error(`Error in mirrorForecast for pool ${poolId}:`, error);
    return { prediction: null, topPredictors: [] };
  }

  // Filter out the current user's predictions if a userId is provided
  const others = predictions.filter(
    p => {
      const uid = p?.user?.id ?? p?.predictor_account;
      return uid && uid !== myUserId;
    }
  );

  if (others.length === 0) return { prediction: null, topPredictors: [] };

  // Deduplicate predictions by user, keeping only the most recent one
  const uniqueByUser = new Map<string, any>();
  for (const p of others) {
    const uid = p?.user?.id ?? p?.predictor_account;
    if (!uid) continue;
    const existing = uniqueByUser.get(uid);
    const pDate = p.updated_at ? new Date(p.updated_at) : new Date(0);
    const eDate = existing?.updated_at ? new Date(existing.updated_at) : new Date(0);
    if (!existing || pDate > eDate) {
      uniqueByUser.set(uid, p);
    }
  }

  // Fetch precision scores for all unique predictors
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

  // Take the top 5 predictors by score, filtering out those with no prediction value
  const TOP_N = 5;
  const top = scored
    .filter(x => x.value > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
  
  if (top.length === 0) return { prediction: null, topPredictors: [] };

  const totalScore = top.reduce((s, x) => s + x.score, 0);
  
  // Calculate weighted average
  let prediction = null;
  if (totalScore > 0) {
    prediction = top.reduce((s, x) => s + x.value * x.score, 0) / totalScore;
  } else {
    // Simple average if no scores are available
    prediction = top.reduce((s, x) => s + x.value, 0) / top.length;
  }

  return {
    prediction,
    topPredictors: top.map(t => ({
      username: t.username,
      score: t.score,
      forecast: t.value
    }))
  };
}

export { trepa };
