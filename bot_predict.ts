import { Trepa, credentialsFromEnv } from '@trepa/sdk'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

// Manual .env parser for local runs
const envPath = './.env';
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const trepa = new Trepa({ credentials: credentialsFromEnv() });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function isCloudflareBlock(err: any): boolean {
  const text = [err?.message, err?.body, typeof err === 'string' ? err : null]
    .filter(Boolean).join(' ');
  return (
    text.includes('Access Restricted') ||
    text.includes('access restricted') ||
    text.includes('<!doctype') ||
    text.includes('<html') ||
    text.includes('cloudflare') ||
    (text.includes('Unexpected token') && text.includes('<'))
  );
}

async function log(tag: string, message: string) {
  console.log(`[${tag}] ${message}`);
  try {
    await supabase.from('bot_logs').insert([{ tag, message }]);
  } catch (e) {
    console.error('Failed to write log to Supabase:', e);
  }
}

async function runPredict() {
  console.log('🤖 Bot predict starting (GitHub Actions)...');

  try {
    // 1. Find active pool using robust discovery
    const bitcoinStreak = await trepa.streaks.bitcoin();
    if (!bitcoinStreak?.id) {
      await log('SKIP', 'Bitcoin streak not found');
      return;
    }

    let pool: any = null;

    // A. Try pools.list(ACTIVE) first — most reliable for live pools
    try {
      const activePools: any[] = await (trepa.pools as any).list({
        filter_by: ['ACTIVE'],
        streak_id: bitcoinStreak.id,
        limit: 1,
      });
      if (Array.isArray(activePools) && activePools.length > 0) {
        pool = activePools[0];
      }
    } catch { /* ignore */ }

    // B. Fallback to poolDetails
    if (!pool) {
      try {
        const details = await trepa.streaks.poolDetails(bitcoinStreak.id);
        if (details?.current_pool && !details.current_pool.is_closed) {
          pool = details.current_pool;
        }
      } catch { /* ignore */ }
    }

    // C. Final fallback: list all pools and filter manually
    if (!pool) {
      try {
        const poolsRaw: any = await (trepa.streaks as any).pools(bitcoinStreak.id, { limit: 10 });
        const pools: any[] = poolsRaw?.pools ?? (Array.isArray(poolsRaw) ? poolsRaw : []);
        const now = new Date();
        pool = pools.find((p: any) =>
          !p.is_closed &&
          p.prediction_end_date &&
          now < new Date(p.prediction_end_date)
        ) ?? null;
      } catch { /* ignore */ }
    }

    // Always update cache if we found a pool
    if (pool) {
      await supabase.from('pool_cache').upsert({
        id: 1,
        pool,
        updated_at: new Date().toISOString()
      });
    }

    if (!pool) {
      await log('SKIP', 'No active pool — warm-up mode');
      return;
    }

    console.log(`✅ Active pool: ${pool.id} (${pool.title})`);
    
    // Check if prediction window is open
    const now = new Date();
    const startDate = pool.prediction_start_date ? new Date(pool.prediction_start_date) : null;
    const endDate = pool.prediction_end_date ? new Date(pool.prediction_end_date) : null;
    
    const isStarted = !startDate || now >= startDate;
    const isNotEnded = !endDate || now < endDate;

    if (!isStarted || !isNotEnded) {
      await log('SKIP', `"${pool.title}" not in prediction window — locked`);
      return;
    }

    await log('ROUND', `"${pool.title}" open — calculating mirror...`);

    // 2. Get bot identity
    const me = await trepa.me();

    // 3. Build mirror forecast from top scorers
    let mirrorValue: number | null = null;
    const topPredictors: Array<{ username: string; score: number; forecast: number }> = [];

    try {
      const predictions: any[] = await trepa.pools.predictions(pool.id, { limit: 20, includes: ['user'] });
      if (Array.isArray(predictions) && predictions.length > 0) {
        const others = predictions.filter(p => {
          const uid = p?.user?.id ?? p?.predictor_account;
          return uid && uid !== me.id;
        });

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
            let score = 0;
            try {
              const stats: any = await trepa.users.statistics(uid);
              score = Number(stats?.precision_score ?? stats?.precisionScore ?? stats?.score ?? 0) || 0;
            } catch {}
            return {
              uid,
              username: p.user?.username ?? `anon-${uid.slice(0, 4)}`,
              value: isNaN(value) ? 0 : value,
              score
            };
          })
        );

        const top = scored.filter(x => x.value > 0).sort((a, b) => b.score - a.score).slice(0, 5);
        if (top.length > 0) {
          const totalScore = top.reduce((s, x) => s + x.score, 0);
          mirrorValue = totalScore > 0
            ? top.reduce((s, x) => s + x.value * x.score, 0) / totalScore
            : top.reduce((s, x) => s + x.value, 0) / top.length;
          top.forEach(t => topPredictors.push({ username: t.username, score: t.score, forecast: t.value }));
        }
      }
    } catch (err: any) {
      console.warn('⚠️ Mirror forecast failed:', err?.message);
    }

    let value = mirrorValue;
    if (!value) {
      const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const { price } = await priceRes.json();
      value = parseFloat(price);
      await log('FALLBACK', `No peers yet — using spot $${value.toFixed(0)}`);
    } else {
      await log('MIRROR', `Top ${topPredictors.length} experts → $${value.toFixed(0)}`);
    }

    // 4. Submit or update prediction
    const myPredictions: any[] = await trepa.users.predictions(me.id, { limit: 5 } as any);
    const existingPrediction = myPredictions.find(
      (p: any) => p.pool_id === pool.id || p.poolId === pool.id
    );

    if (existingPrediction) {
      const predId = existingPrediction.id ?? existingPrediction.prediction_id;
      await trepa.predictions.update({ predictionId: predId, value });
      await log('UPDATED', `Revised to $${value.toFixed(0)}`);
    } else {
      await trepa.predictions.create({ poolId: pool.id, stake: pool.min_stake, value });
      await log('SUBMITTED', `$${value.toFixed(0)} @ stake ${pool.min_stake}`);
    }

  } catch (error: any) {
    if (isCloudflareBlock(error)) {
      await log('BLOCKED', 'GitHub Actions IP is blocked by Trepa/Cloudflare. Contact support@trepa.io to whitelist GitHub Actions IP ranges, or run the bot from a non-datacenter IP.');
      console.error('❌ BLOCKED by Cloudflare — GitHub Actions datacenter IP is not whitelisted by Trepa');
      process.exit(1);
    }
    await log('ERROR', error.message ?? String(error));
    console.error('❌ PREDICT FAILED:', error);
    process.exit(1);
  }
}

runPredict();
