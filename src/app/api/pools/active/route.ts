import { NextResponse } from 'next/server';
import { getNextSessionTime, getActiveBitcoinPool } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();

    let rawPool = data?.pool ?? null;
    const cacheAge = data?.updated_at
      ? Date.now() - new Date(data.updated_at).getTime()
      : Infinity;

    // Refresh if stale (> 2 min) — Vercel now runs from Singapore (sin1), not US
    if (cacheAge > 120_000) {
      try {
        const active = await getActiveBitcoinPool();
        rawPool = active.pool;
      } catch (err: any) {
        console.error('[pools/active] Trepa sync failed:', err?.message);
      }
    }

    // Expired pools show as WARM_UP
    const pool = rawPool?.prediction_end_date && new Date() > new Date(rawPool.prediction_end_date)
      ? null
      : rawPool;

    return NextResponse.json({
      pool,
      nextSessionAt: getNextSessionTime(),
      expertCount: 0,
      status: pool ? 'ACTIVE' : 'WARM_UP',
    });
  } catch (error: any) {
    console.error('[pools/active] Error:', error);
    return NextResponse.json({
      pool: null,
      nextSessionAt: getNextSessionTime(),
      expertCount: 0,
      status: 'WARM_UP',
      syncError: error.message,
    });
  }
}
