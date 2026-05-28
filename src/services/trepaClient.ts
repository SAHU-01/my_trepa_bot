import { credentialsFromEnv, Trepa } from '@trepa/sdk';

/**
 * Trepa Prediction Arena - Service Layer
 * 
 * This service abstracts the Trepa SDK to provide a clean interface for the application.
 * It includes logic for fetching pools, calculating precision scores, and mirroring forecasts.
 */

// Initialize the Trepa SDK with credentials from environment variables
const trepa = new Trepa({ credentials: credentialsFromEnv() });

// Cache for user precision scores to minimize API calls
const scoreCache = new Map<string, number>();

/**
 * FORWARD-COMPATIBILITY ABSTRACTION:
 * This function handles fetching a pool.
 */
export async function getPool(poolId: string) {
  return await trepa.pools.get(poolId);
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
    const bitcoinStreak = await trepa.streaks.bitcoin();
    const details = await trepa.streaks.poolDetails(bitcoinStreak.id);
    const pool = details.current_pool;

    const isTrulyActive = pool && 
                          pool.status === 'ACTIVE' && 
                          new Date() < new Date(pool.prediction_end_date);

    let expertCount = 0;
    if (isTrulyActive) {
      // Limit to 50 for count purposes to reduce API load
      const predictions = await trepa.pools.predictions(pool.id, { limit: 50 });
      expertCount = predictions.length;
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
    const stats: any = await trepa.users.statistics(userId);
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
    
    // Limit to 10 pools for Vercel Hobby performance (max 10s execution)
    const poolsRaw: any = await trepa.streaks.pools(bitcoinStreak.id, { limit: 10 });
    const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.pools || poolsRaw?.data || []);
    
    if (!pools || pools.length === 0) return;

    const expertStats = new Map<string, { 
      username: string; 
      wins: number; 
      totalStaked: number;
      accuracies: number[];
    }>();
    
    // Fetch predictions one by one or in small chunks to avoid overloading Trepa 500s
    for (const pool of pools) {
      try {
        const predictions: any = await trepa.pools.predictions(pool.id, { limit: 10, includes: ['user'] });
        if (!Array.isArray(predictions)) continue;

        const maxPrecision = Math.max(...predictions.map(p => Number(p.precision) || 0));

        predictions.forEach(p => {
          const username = p.user?.username || `anon-${p.predictor_account.slice(0, 4)}`;
          const stake = Number(p.stake) || 0;
          const precision = Number(p.precision) || 0;
          const existing = expertStats.get(username);
          
          const isLocalWinner = (precision > 0 && precision >= maxPrecision);

          if (existing) {
            existing.wins += isLocalWinner ? 1 : 0;
            existing.totalStaked += stake;
            existing.accuracies.push(precision);
          } else {
            expertStats.set(username, {
              username,
              wins: isLocalWinner ? 1 : 0,
              totalStaked: stake,
              accuracies: [precision]
            });
          }
        });
      } catch (err) {
        console.warn(`Skipping pool ${pool.id} in radar sync due to error:`, err);
      }
    }
    
    // INDUSTRY STANDARD SCORING ALGORITHM
    const result = [...expertStats.values()]
      .map(e => {
        const avgPrecision = e.accuracies.reduce((a, b) => a + b, 0) / e.accuracies.length;
        const winRate = (e.wins / e.accuracies.length) * 100;
        // WHALE SCORING: (SOL * 50) + (Wins * 100) + Avg Precision
        const score = (e.totalStaked * 50) + (e.wins * 100) + (avgPrecision);
        
        return {
          username: e.username,
          wins: e.wins,
          totalStaked: e.totalStaked,
          winRate: Math.round(winRate),
          avgPrecision: Math.round(avgPrecision),
          score: Math.round(score),
          // A Whale bets big and wins often
          isWhale: (e.totalStaked > 10 && e.wins > 1) 
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (result.length > 0) {
      cachedWhales = result;
      // Persist to disk for cold-start performance
      fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
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

  // If we already have data in memory and it's fresh enough (less than 1 min old), use it
  if (cachedWhales.length > 0 && refreshIntervalStarted) {
    return cachedWhales;
  }

  try {
    console.log('📡 Fetching Whale Radar from GitHub Master...');
    const res = await fetch(GITHUB_RAW_URL, { 
      cache: 'no-store',
      next: { revalidate: 0 } // Next.js specific cache bypass
    });
    
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedWhales = data;
        refreshIntervalStarted = true; // Mark as "active" so we don't spam refreshes
        console.log(`✅ Whale Radar synced from GitHub (${data.length} experts)`);
        return cachedWhales;
      }
    }
  } catch (err) {
    console.error('⚠️ GitHub fetch failed, attempting background scan:', err);
  }

  // Fallback: If GitHub is empty or fails, run the heavy background scan
  if (!refreshIntervalStarted) {
    refreshIntervalStarted = true;
    const now = new Date();
    const isLiveHour = now.getUTCHours() === 13;
    
    // Only perform the heavy refresh if the GitHub fetch failed or returned empty
    if (cachedWhales.length === 0) {
      console.log('🔄 GitHub empty: Starting emergency background refresh...');
      await runBackgroundRefresh();
    }
    
    const interval = isLiveHour ? 1000 * 60 * 5 : 1000 * 60 * 60 * 12;
    setInterval(runBackgroundRefresh, interval);
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
    // We include 'user' to get usernames and social proof
    // Limit to 20 to avoid overloading the API
    predictions = await trepa.pools.predictions(poolId, { limit: 20, includes: ['user'] });
  } catch (error) {
    console.error(`Error in mirrorForecast for pool ${poolId}:`, error);
    return { prediction: null, topPredictors: [] };
  }

  // Filter out the current user's predictions if a userId is provided
  const others = predictions.filter(
    p => {
      const uid = p?.user?.id ?? p?.predictor_account;
      return uid !== myUserId;
    }
  );

  if (others.length === 0) return { prediction: null, topPredictors: [] };

  // Deduplicate predictions by user, keeping only the most recent one
  const uniqueByUser = new Map<string, any>();
  for (const p of others) {
    const uid = p?.user?.id ?? p?.predictor_account;
    if (!uid) continue;
    const existing = uniqueByUser.get(uid);
    if (!existing || new Date(p.updated_at) > new Date(existing.updated_at)) {
      uniqueByUser.set(uid, p);
    }
  }

  // Fetch precision scores for all unique predictors
  const scored = await Promise.all(
    [...uniqueByUser.entries()].map(async ([uid, p]) => {
      const value = Number(p.value ?? p.prediction);
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
