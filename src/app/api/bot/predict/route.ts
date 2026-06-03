import { NextRequest, NextResponse } from 'next/server';
import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { mirrorForecast, getActiveBitcoinPool } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const trepa = new Trepa({ credentials: credentialsFromEnv() });

async function log(tag: string, message: string) {
  console.log(`[${tag}] ${message}`);
  await supabaseAdmin.from('bot_logs').insert([{ tag, message }]);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Read pool from Supabase cache
    const { data: poolCacheData } = await supabaseAdmin
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();

    let pool = poolCacheData?.pool ?? null;
    const cacheAge = poolCacheData?.updated_at
      ? Date.now() - new Date(poolCacheData.updated_at).getTime()
      : Infinity;

    // 2. Refresh only when cache is stale (> 5 min). A fresh null means no pool right now.
    if (cacheAge > 300_000) {
      const active = await getActiveBitcoinPool();
      pool = active.pool;
    }

    if (!pool) {
      return NextResponse.json({ skipped: true, reason: 'no-pool' });
    }

    const predictionWindowOpen =
      pool.prediction_end_date && new Date() < new Date(pool.prediction_end_date);

    if (!predictionWindowOpen) {
      return NextResponse.json({ skipped: true, reason: 'watch-phase' });
    }

    await log('ROUND', `"${pool.title}" open — calculating mirror...`);

    // 3. Get bot identity
    const me = await trepa.me();

    // 4. Calculate mirror forecast
    const { prediction: mirrorValue, topPredictors } = await mirrorForecast(pool.id, me.id);

    let value = mirrorValue;
    if (!value) {
      const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const { price } = await priceRes.json();
      value = parseFloat(price);
      await log('FALLBACK', `No peers yet — using spot $${value.toFixed(0)}`);
    } else {
      await log('MIRROR', `Top ${topPredictors.length} experts → $${value.toFixed(0)}`);
    }

    // 5. Check if we already have a prediction for this pool
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

    return NextResponse.json({ success: true, pool: pool.title, value });
  } catch (error: any) {
    await log('ERROR', error.message ?? String(error));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
