import { NextResponse } from 'next/server';
import { getNextSessionTime, getActiveBitcoinPool } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Try reading from cache first
    const { data } = await supabaseAdmin
      .from('pool_cache')
      .select('pool, updated_at')
      .eq('id', 1)
      .single();

    let rawPool = data?.pool ?? null;
    let updatedAt = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
    
    // 2. If missing or older than 2 minutes, proactively refresh from Trepa SDK
    const isStale = Date.now() - updatedAt > 120_000;
    
    if (!rawPool || isStale) {
      const active = await getActiveBitcoinPool();
      rawPool = active.pool;
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
    });
  } catch (error: any) {
    console.error('Error in /api/pools/active:', error);
    return NextResponse.json({ pool: null, nextSessionAt: getNextSessionTime(), expertCount: 0, status: 'WARM_UP' });
  }
}
