import { NextResponse } from 'next/server';
import { trepa, isCloudflareBlock } from '@/services/trepaClient';
import { supabaseAdmin as supabase } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

// Reads pool from Supabase cache only. Trepa direct calls are only made here to
// fetch predictions (read-only), which may still be blocked by Cloudflare.
// Pool discovery never happens from Vercel — that's GitHub Actions' job.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const results = { scanned: 0, mirrored: 0, errors: [] as string[] };

  try {
    // Read pool from Supabase cache (written by GitHub Actions bot_predict.ts)
    const { data: poolCacheData } = await supabase
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();

    const pool = poolCacheData?.pool ?? null;
    const cacheAge = poolCacheData?.updated_at
      ? Date.now() - new Date(poolCacheData.updated_at).getTime()
      : Infinity;

    if (!pool) return NextResponse.json({ message: 'No active pool in cache' });
    if (cacheAge > 1_800_000) return NextResponse.json({ message: 'Cache stale — waiting for GitHub Actions to refresh' });

    // Fetch predictions for this pool from Trepa (read-only — may be blocked)
    let predictionsRaw: any;
    try {
      predictionsRaw = await trepa.pools.predictions(pool.id, { limit: 50, includes: ['user'] });
    } catch (err: any) {
      if (isCloudflareBlock(err)) {
        console.error('[mirror-trigger] Trepa API blocked by Cloudflare');
        return NextResponse.json({ error: 'IP_BLOCKED', detail: 'Trepa blocks Vercel datacenter IPs.' }, { status: 503 });
      }
      throw err;
    }

    const predictions = Array.isArray(predictionsRaw) ? predictionsRaw : (predictionsRaw?.data || []);
    results.scanned = predictions.length;

    const { data: followers, error: followError } = await supabase
      .from('user_follows')
      .select('*')
      .eq('is_active', true);

    if (followError) throw followError;

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

    return NextResponse.json({ success: true, ...results, duration: Date.now() - start });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
