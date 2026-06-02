import { NextRequest, NextResponse } from 'next/server';
import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { mirrorForecast } from '@/services/trepaClient';
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
    // 1. Read pool from Supabase cache (written by GitHub Actions bot_predict.ts)
    // Avoids Cloudflare blocking Vercel datacenter IPs on direct Trepa API calls.
    const { data: poolCacheData } = await supabaseAdmin
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();
    const pool = poolCacheData?.pool ?? null;
    if (!pool) {
      await log('SKIP', 'No active pool — warm-up mode');
      return NextResponse.json({ skipped: true, reason: 'no-pool' });
    }

    const predictionWindowOpen =
      pool.prediction_end_date && new Date() < new Date(pool.prediction_end_date);

    if (!predictionWindowOpen) {
      await log('SKIP', `"${pool.title}" in Watch Phase — locked`);
      return NextResponse.json({ skipped: true, reason: 'watch-phase' });
    }

    await log('ROUND', `"${pool.title}" open — calculating mirror...`);

    // 2. Get bot identity
    const me = await trepa.me();

    // 3. Calculate mirror forecast
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

    // 4. Check if we already have a prediction for this pool (fetch from Trepa)
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
