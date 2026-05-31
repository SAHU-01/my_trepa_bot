import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { logAudit } from './supabaseClient';

/**
 * Trepa Prediction Arena - Service Layer
 * 
 * This service abstracts the Trepa SDK to provide a clean interface for the application.
 * It includes logic for fetching pools, calculating precision scores, and mirroring forecasts.
 */

// Initialize the Trepa SDK with credentials from environment variables
const trepa = new Trepa({ credentials: credentialsFromEnv() });

/**
 * Utility to wrap SDK calls with audit logging.
 */
async function withAudit<T>(
  name: string,
  method: string,
  fn: () => Promise<T>,
  payload?: any
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    
    // Log success
    logAudit({
      event_type: 'API_CALL',
      method,
      endpoint: name,
      status: 200,
      payload,
      response: result,
      duration_ms: duration
    });
    
    return result;
  } catch (error: any) {
    const duration = Date.now() - start;
    
    // Log error
    logAudit({
      event_type: 'ERROR',
      method,
      endpoint: name,
      status: error.status || 500,
      payload,
      response: { message: error.message, body: error.body, code: error.code },
      duration_ms: duration
    });
    
    throw error;
  }
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
 * Fetches the current active pool for the Bitcoin Flash streak.
 * Optimized with parallel fetching and short-lived caching.
 */
export async function getActiveBitcoinPool() {
  const now = Date.now();
  if (cachedActivePool && (now - lastPoolFetch) < POOL_CACHE_TTL) {
    return cachedActivePool;
  }

  try {
    const bitcoinStreak = await withAudit('streaks.bitcoin', 'GET', () => trepa.streaks.bitcoin());
    if (!bitcoinStreak?.id) return { pool: null, expertCount: 0 };

    const details = await withAudit('streaks.poolDetails', 'GET', () => trepa.streaks.poolDetails(bitcoinStreak.id), { streakId: bitcoinStreak.id });
    const pool = details?.current_pool;

    const isTrulyActive = pool &&
                          pool.prediction_end_date &&
                          new Date() < new Date(pool.prediction_end_date);

    let expertCount = 0;
    if (isTrulyActive) {
      // Limit to 50 for count purposes to reduce API load
      const predictions = await withAudit('pools.predictions', 'GET', () => trepa.pools.predictions(pool.id, { limit: 50 }), { poolId: pool.id });
      expertCount = Array.isArray(predictions) ? predictions.length : 0;
      const result = { pool, expertCount };
      cachedActivePool = result;
      lastPoolFetch = Date.now();
      return result;
    }

    const fallback = { pool: null, expertCount: 0 };
    cachedActivePool = fallback;
    lastPoolFetch = Date.now();
    return fallback;
  } catch (error) {
    console.error('Error fetching active pool:', error);
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
import fs from 'fs';
import path from 'path';

// Senior Pattern: Persistent File-Based Cache
const CACHE_FILE = path.join(process.cwd(), 'whales_cache.json');
let cachedWhales: any[] = [];
let isRefreshing = false;
let refreshIntervalStarted = false;

// Load from file on startup for 0ms cold-start latency
try {
  if (fs.existsSync(CACHE_FILE)) {
    cachedWhales = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  }
} catch (e) {
  console.error('Failed to load whales cache from file:', e);
}

async function runBackgroundRefresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const bitcoinStreak = await trepa.streaks.bitcoin();
    if (!bitcoinStreak?.id) throw new Error('Bitcoin streak not found');
    
    // Limit to 10 pools for Vercel Hobby performance (max 10s execution)
    const poolsRaw: any = await trepa.streaks.pools(bitcoinStreak.id, { limit: 10 });
    const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.pools || poolsRaw?.data || []);
    
    if (!pools || pools.length === 0) {
      isRefreshing = false;
      return;
    }

    const expertStats = new Map<string, { 
      username: string; 
      uid: string;
      wins: number; 
      totalStaked: number;
      accuracies: number[];
      recentWins: Array<{ poolId: string; precision: number; stake: number }>;
    }>();
    
    // Process pools to find relative winners
    for (const pool of pools) {
      if (!pool?.id) continue;
      try {
        const predictions: any = await trepa.pools.predictions(pool.id, { limit: 20, includes: ['user'] });
        if (!Array.isArray(predictions) || predictions.length === 0) continue;

        // RELATIVE WIN LOGIC: A win is defined as being in the top 10% of that specific round
        const resolved = predictions
          .filter(p => (Number(p.precision) || 0) > 0)
          .sort((a, b) => Number(b.precision) - Number(a.precision));
        
        const winThreshold = resolved[Math.floor(resolved.length * 0.1)]?.precision || resolved[0]?.precision || 100;

        predictions.forEach(p => {
          const username = p.user?.username || `anon-${(p.predictor_account || '0000').slice(0, 4)}`;
          const uid = p.user?.id || p.predictor_account;
          if (!uid) return;
          
          const stake = Number(p.stake) || 0;
          const precision = Number(p.precision) || 0;
          const existing = expertStats.get(username);
          
          const isWin = precision > 0 && precision >= winThreshold;

          if (existing) {
            existing.wins += isWin ? 1 : 0;
            existing.totalStaked += stake;
            existing.accuracies.push(precision);
            if (isWin && existing.recentWins.length < 5) {
              existing.recentWins.push({ poolId: pool.id, precision, stake });
            }
          } else {
            expertStats.set(username, {
              username,
              uid,
              wins: isWin ? 1 : 0,
              totalStaked: stake,
              accuracies: [precision],
              recentWins: isWin ? [{ poolId: pool.id, precision, stake }] : []
            });
          }
        });
      } catch (err) {
        console.warn(`Skipping pool ${pool.id} in radar sync:`, err);
      }
    }
    
    // INDUSTRY STANDARD SCORING ALGORITHM
    const result = await Promise.all([...expertStats.values()]
      .map(async (e) => {
        const avgPrecision = e.accuracies.reduce((a, b) => a + b, 0) / e.accuracies.length;
        
        // Fetch real lifetime stats for "Exact Perspective"
        let lifetimeWins = 0;
        let lifetimeWinRate = 0;
        try {
          const stats: any = await trepa.users.statistics(e.uid);
          lifetimeWins = Number(stats.wins ?? stats.total_wins ?? 0);
          lifetimeWinRate = Number(stats.win_rate ?? stats.winRate ?? 0);
        } catch (err) {
          console.warn(`Failed to fetch lifetime stats for ${e.username} (${e.uid})`);
        }

        // SCORING: Lifetime Wins + Lifetime Win Rate + Stake + Avg Precision
        const score = (lifetimeWins * 100) + (lifetimeWinRate * 20) + (e.totalStaked * 10) + (avgPrecision);
        
        return {
          username: e.username,
          wins: lifetimeWins,
          totalStaked: e.totalStaked,
          winRate: Math.round(lifetimeWinRate),
          avgPrecision: Math.round(avgPrecision),
          score: Math.round(score),
          isWhale: (e.totalStaked > 10 || lifetimeWins > 5),
          recentWins: e.recentWins
        };
      }));

    const finalWhales = result
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (finalWhales.length > 0) {
      cachedWhales = finalWhales;
      // Persist to disk for cold-start performance
      fs.writeFileSync(CACHE_FILE, JSON.stringify(finalWhales, null, 2));
    }
  } catch (error) {
    console.error('CRITICAL: Professional Whale Scan failed:', error);
  } finally {
    isRefreshing = false;
  }
}

/**
 * Fetches the Hall of Fame - prioritizing "Whales" (High Stake + High Success).
 * Now fetches from the GitHub Raw URL to ensure persistence across Vercel restarts.
 */
export async function getHallOfFame() {
  // Use a timestamp to bypass GitHub's raw cache (crucial for "database" behavior)
  const GITHUB_RAW_URL = `https://raw.githubusercontent.com/SAHU-01/my_trepa_bot/main/whales_cache.json?t=${Date.now()}`;

  // If we already have data in memory and it's from a high-quality source, keep it
  if (cachedWhales.length > 0 && refreshIntervalStarted) {
    return cachedWhales;
  }

  try {
    console.log('📡 Fetching Whale Radar from GitHub Master...');
    const res = await fetch(GITHUB_RAW_URL, { 
      cache: 'no-store',
      next: { revalidate: 0 }
    });
    
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedWhales = data;
        // CRITICAL: We found high-quality "Deep Scan" data. 
        // We set refreshIntervalStarted to true but DO NOT start the interval.
        // This prevents the low-quality 10-pool scan from overwriting the 100-pool data.
        refreshIntervalStarted = true; 
        console.log(`✅ Whale Radar synced from GitHub (${data.length} experts) - Refresh disabled to preserve quality`);
        return cachedWhales;
      }
    }
  } catch (err) {
    console.error('⚠️ GitHub fetch failed, attempting emergency background scan:', err);
  }

  // FALLBACK: Only run the heavy 10-pool scan if GitHub is literally unreachable or empty
  if (!refreshIntervalStarted) {
    refreshIntervalStarted = true;
    console.log('🔄 EMERGENCY: GitHub empty or unreachable. Starting low-quality background refresh...');
    await runBackgroundRefresh();
    
    // Low-quality refresh interval (keep it infrequent to avoid API pressure)
    setInterval(runBackgroundRefresh, 1000 * 60 * 60); 
  }

  return cachedWhales;
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
