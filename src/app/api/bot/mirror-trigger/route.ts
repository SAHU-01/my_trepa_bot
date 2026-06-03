import { NextResponse } from 'next/server';
import { trepa, getActiveBitcoinPool } from '@/services/trepaClient';
import { supabaseAdmin as supabase } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const results = {
    scanned: 0,
    mirrored: 0,
    errors: [] as string[]
  };

  try {
    // 1. Read pool from Supabase cache
    const { data: poolCacheData } = await supabase
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();

    let pool = poolCacheData?.pool ?? null;
    const cacheAge = poolCacheData?.updated_at
      ? Date.now() - new Date(poolCacheData.updated_at).getTime()
      : Infinity;

    // 2. Proactively refresh if cache is missing or stale (> 5 min)
    if (cacheAge > 300_000) {
      try {
        const active = await getActiveBitcoinPool();
        pool = active.pool;
      } catch (err: any) {
        console.error('[mirror-trigger] Pool sync failed:', err?.message);
      }
    }

    if (!pool) return NextResponse.json({ message: 'No active pool' });

    // 3. Fetch all predictions for this pool
    const predictionsRaw: any = await trepa.pools.predictions(pool.id, { limit: 50, includes: ['user'] });
    const predictions = Array.isArray(predictionsRaw) ? predictionsRaw : (predictionsRaw?.data || []);
    results.scanned = predictions.length;

    // 4. Find active followers in our database
    const { data: followers, error: followError } = await supabase
      .from('user_follows')
      .select('*')
      .eq('is_active', true);

    if (followError) throw followError;

    // 5. Process Mirroring
    for (const prediction of predictions) {
      const whaleUsername = prediction.user?.username;
      if (!whaleUsername) continue;

      const relevantFollowers = followers.filter(f => f.whale_username === whaleUsername);

      for (const follower of relevantFollowers) {
        const { data: existing } = await supabase
          .from('mirror_activity')
          .select('id')
          .eq('user_address', follower.user_address)
          .eq('pool_id', pool.id)
          .maybeSingle();

        if (existing) continue;

        const forecastValue = Number(prediction.prediction);
        const stakeAmount = Math.min(Number(follower.max_stake), Number(pool.max_stake || 10));

        try {
          const { error: activityError } = await supabase
            .from('mirror_activity')
            .insert([{
              user_address: follower.user_address,
              whale_username: whaleUsername,
              pool_id: pool.id,
              forecast_value: forecastValue,
              stake_amount: stakeAmount,
              status: 'SUCCESS',
              tx_hash: 'SIMULATED_' + Math.random().toString(36).substring(7)
            }]);

          if (activityError) throw activityError;
          results.mirrored++;
        } catch (e: any) {
          results.errors.push(`Failed for ${follower.user_address}: ${e.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      duration: Date.now() - start
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
