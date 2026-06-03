import { NextResponse } from 'next/server';
import { getNextSessionTime, getActiveBitcoinPool } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  let syncError: string | null = null;

  try {
    // 1. Read from cache
    const { data } = await supabaseAdmin
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();

    let rawPool = data?.pool ?? null;
    const cacheAge = data?.updated_at ? Date.now() - new Date(data.updated_at).getTime() : Infinity;

    // 2. Refresh if cache is stale (> 2 min). Use stale-only check — a fresh null cache
    //    means there is genuinely no pool right now; don't re-fetch on every request.
    if (cacheAge > 120_000) {
      try {
        const active = await getActiveBitcoinPool();
        rawPool = active.pool;
      } catch (err: any) {
        syncError = err?.message ?? String(err);
        console.error('[pools/active] Trepa sync failed:', syncError);
        // Keep rawPool from stale cache rather than returning nothing
      }
    }

    // Treat expired pools as no pool — don't show a closed pool as "Watch Phase" forever
    const pool = rawPool?.prediction_end_date && new Date() > new Date(rawPool.prediction_end_date)
      ? null
      : rawPool;

    return NextResponse.json({
      pool,
      nextSessionAt: getNextSessionTime(),
      expertCount: 0,
      status: pool ? 'ACTIVE' : 'WARM_UP',
      ...(syncError ? { syncError } : {}),
    });
  } catch (error: any) {
    console.error('[pools/active] Unexpected error:', error);
    return NextResponse.json({
      pool: null,
      nextSessionAt: getNextSessionTime(),
      expertCount: 0,
      status: 'WARM_UP',
      syncError: error.message,
    });
  }
}
