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

    const pool = data?.pool ?? null;
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
