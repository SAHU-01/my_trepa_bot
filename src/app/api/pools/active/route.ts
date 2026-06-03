import { NextResponse } from 'next/server';
import { getNextSessionTime } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from('pool_cache')
      .select('pool')
      .eq('id', 1)
      .single();

    const rawPool = data?.pool ?? null;
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
    return NextResponse.json({ pool: null, nextSessionAt: getNextSessionTime(), expertCount: 0, status: 'WARM_UP' });
  }
}
