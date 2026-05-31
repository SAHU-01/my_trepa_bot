import { NextResponse } from 'next/server';
import { getActiveBitcoinPool, getNextSessionTime } from '@/services/trepaClient';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { pool, expertCount } = await getActiveBitcoinPool();
    const nextSessionAt = getNextSessionTime();

    // Write a network log so the dashboard always has activity
    const logMsg = pool
      ? `Pool "${pool.title}" LIVE — ${expertCount} expert(s) competing`
      : 'No active pool — warm-up mode';
    supabaseAdmin.from('bot_logs').insert([{ tag: 'POOL', message: logMsg }]).then(() => {});

    return NextResponse.json({
      pool,
      nextSessionAt,
      expertCount,
      status: pool ? 'ACTIVE' : 'WARM_UP',
      debug: !pool ? 'No active pool found or API error. Check Trepa API keys.' : undefined
    });
  } catch (error) {
    console.error('Error fetching active pool:', error);
    return NextResponse.json({ error: 'Failed to fetch active pool' }, { status: 500 });
  }
}
