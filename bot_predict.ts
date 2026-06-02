import { Trepa } from '@trepa/sdk'
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

const trepa = new Trepa({
  credentials: [{
    apiKey: process.env.TREPA_API_KEY || '',
    privateKey: process.env.TREPA_PRIVATE_KEY || ''
  }]
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function log(tag: string, message: string) {
  console.log(`[${tag}] ${message}`);
  await supabase.from('bot_logs').insert([{ tag, message }]);
}

async function runPredict() {
  console.log('🤖 Bot predict starting (GitHub Actions)...');

  try {
    // 1. Find active pool
    const bitcoinStreak = await trepa.streaks.bitcoin();
    if (!bitcoinStreak?.id) {
      await log('SKIP', 'Bitcoin streak not found');
      return;
    }

    let pool: any = null;

    // Use streaks.pools() with time-window filtering — more reliable than
    // pools.list(filter_by:ACTIVE) or poolDetails().current_pool (both unreliable).
    let poolsRaw: any;
    try {
      poolsRaw = await trepa.streaks.pools(bitcoinStreak.id, { limit: 10 } as any);
    } catch (err: any) {
      await log('ERROR', `streaks.pools threw: ${err?.message ?? err}`);
      return;
    }
    const pools: any[] = poolsRaw?.pools ?? (Array.isArray(poolsRaw) ? poolsRaw : []);

    const now = new Date();

    // 1. Prefer a pool whose prediction window includes right now
    pool = pools.find(p =>
      !p.is_closed &&
      p.prediction_start_date && p.prediction_end_date &&
      new Date(p.prediction_start_date) <= now &&
      now < new Date(p.prediction_end_date)
    ) ?? null;

    // 2. Fall back to most recent non-closed pool (Watch Phase)
    if (!pool) {
      pool = pools
        .filter((p: any) => !p.is_closed && p.status !== 'CLAIMS_FROZEN' && p.status !== 'FROZEN')
        .sort((a: any, b: any) => new Date(b.prediction_start_date).getTime() - new Date(a.prediction_start_date).getTime())[0]
        ?? null;
    }

    // Always write pool state to cache so Vercel routes stay in sync
    await supabase.from('pool_cache').upsert({
      id: 1,
      pool: pool ?? null,
      updated_at: new Date().toISOString()
    });

    if (!pool) {
      await log('SKIP', 'No active pool — warm-up mode');
      return;
    }

    console.log(`✅ Active pool: ${pool.id} (${pool.title})`);

    const predictionWindowOpen = pool.prediction_end_date && new Date() < new Date(pool.prediction_end_date);
    if (!predictionWindowOpen) {
      await log('SKIP', `"${pool.title}" in Watch Phase — locked`);
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
    await log('ERROR', error.message ?? String(error));
    console.error('❌ PREDICT FAILED:', error);
    process.exit(1);
  }
}

runPredict();
