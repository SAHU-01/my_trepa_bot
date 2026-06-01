import { NextResponse } from 'next/server';
import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { getNextSessionTime } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

const trepa = new Trepa({ credentials: credentialsFromEnv() });

export async function GET() {
  try {
    // Step 1: get streak
    const streak = await trepa.streaks.bitcoin();
    if (!streak?.id) {
      await supabaseAdmin.from('bot_logs').insert([{ tag: 'ERROR', message: 'streaks.bitcoin() returned no ID' }]);
      return NextResponse.json({ pool: null, nextSessionAt: getNextSessionTime(), expertCount: 0, status: 'WARM_UP' });
    }

    // Step 2: get pool details (current_pool)
    const details = await trepa.streaks.poolDetails(streak.id);
    const currentPool = details?.current_pool ?? null;

    // Step 3: get recent pools list as fallback
    const poolsRaw: any = await trepa.streaks.pools(streak.id, { limit: 10 } as any);
    const poolsList: any[] = poolsRaw?.pools ?? (Array.isArray(poolsRaw) ? poolsRaw : []);

    // Log raw data so we can see exactly what Trepa returns
    await supabaseAdmin.from('bot_logs').insert([{
      tag: 'DEBUG',
      message: `streak=${streak.id.slice(0,8)} | current_pool=${currentPool?.id?.slice(0,8) ?? 'null'} status=${currentPool?.status ?? 'N/A'} is_closed=${currentPool?.is_closed ?? 'N/A'} | pools_list count=${poolsList.length} statuses=[${poolsList.slice(0,3).map(p => p.status + '/' + p.is_closed).join(',')}]`
    }]);

    const now = new Date();

    // Use current_pool if it exists and prediction window is open
    let pool = currentPool && !currentPool.is_closed ? currentPool : null;

    // Fallback: find any pool in the list with an open prediction window
    if (!pool) {
      pool = poolsList.find(p =>
        !p.is_closed &&
        p.prediction_start_date &&
        p.prediction_end_date &&
        new Date(p.prediction_start_date) <= now &&
        now < new Date(p.prediction_end_date)
      ) ?? null;
    }

    // Fallback 2: most recent non-closed pool (Watch Phase)
    if (!pool) {
      pool = poolsList
        .filter(p => !p.is_closed && p.status !== 'CLAIMS_FROZEN' && p.status !== 'FROZEN')
        .sort((a: any, b: any) => new Date(b.prediction_start_date).getTime() - new Date(a.prediction_start_date).getTime())[0]
        ?? null;
    }

    const logMsg = pool ? `Pool "${pool.title}" LIVE — status=${pool.status}` : 'No active pool — warm-up mode';
    await supabaseAdmin.from('bot_logs').insert([{ tag: pool ? 'POOL_LIVE' : 'POOL', message: logMsg }]);

    return NextResponse.json({
      pool: pool ?? null,
      nextSessionAt: getNextSessionTime(),
      expertCount: 0,
      status: pool ? 'ACTIVE' : 'WARM_UP',
    });
  } catch (error: any) {
    await supabaseAdmin.from('bot_logs').insert([{ tag: 'ERROR', message: `pools/active threw: ${error?.message ?? error}` }]);
    return NextResponse.json({ pool: null, nextSessionAt: getNextSessionTime(), expertCount: 0, status: 'WARM_UP' });
  }
}
