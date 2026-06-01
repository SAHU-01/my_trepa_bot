import { NextResponse } from 'next/server';
import { credentialsFromEnv, Trepa } from '@trepa/sdk';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro: 5 min max for cron jobs

const trepa = new Trepa({ credentials: credentialsFromEnv() });

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const bitcoinStreak = await trepa.streaks.bitcoin();
    if (!bitcoinStreak?.id) throw new Error('Bitcoin streak not found');

    const poolsRaw: any = await trepa.streaks.pools(bitcoinStreak.id, { limit: 30 } as any);
    const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.pools || poolsRaw?.data || []);

    if (!pools.length) {
      return NextResponse.json({ message: 'No pools found', count: 0 });
    }

    const expertStats = new Map<string, {
      username: string;
      uid: string;
      wins: number;
      totalStaked: number;
      accuracies: number[];
      poolCount: number;
      recentWins: Array<{ poolId: string; precision: number; stake: number }>;
    }>();

    for (const pool of pools) {
      if (!pool?.id) continue;
      try {
        const predictions: any = await trepa.pools.predictions(pool.id, { limit: 20, includes: ['user'] });
        if (!Array.isArray(predictions) || predictions.length === 0) continue;

        const sorted = predictions
          .filter(p => (Number(p.precision) || 0) > 0)
          .sort((a: any, b: any) => Number(b.precision) - Number(a.precision));

        const winThreshold = sorted[Math.floor(sorted.length * 0.1)]?.precision || sorted[0]?.precision || 100;

        predictions.forEach((p: any) => {
          const username = p.user?.username || `anon-${(p.predictor_account || '0000').slice(0, 4)}`;
          const uid = p.user?.id || p.predictor_account;
          if (!uid) return;

          const stake = Number(p.stake) || 0;
          const precision = Number(p.precision) || 0;
          const isWin = precision > 0 && precision >= winThreshold;
          const existing = expertStats.get(username);

          if (existing) {
            existing.wins += isWin ? 1 : 0;
            existing.totalStaked += stake;
            existing.accuracies.push(precision);
            existing.poolCount += 1;
            if (isWin && existing.recentWins.length < 5) {
              existing.recentWins.push({ poolId: pool.id, precision, stake });
            }
          } else {
            expertStats.set(username, {
              username, uid,
              wins: isWin ? 1 : 0,
              totalStaked: stake,
              accuracies: [precision],
              poolCount: 1,
              recentWins: isWin ? [{ poolId: pool.id, precision, stake }] : []
            });
          }
        });
      } catch {
        // skip pools that fail
      }
    }

    const result = [...expertStats.values()]
      .map(e => {
        const avgPrecision = e.accuracies.reduce((a, b) => a + b, 0) / e.accuracies.length;
        const winRate = (e.wins / e.poolCount) * 100;
        const score = (e.wins * 50) + (e.totalStaked * 10) + (winRate * 2) + avgPrecision;
        return {
          username: e.username,
          wins: e.wins,
          totalStaked: e.totalStaked,
          winRate: Math.round(winRate),
          avgPrecision: Math.round(avgPrecision),
          score: Math.round(score),
          isWhale: e.totalStaked > 10 || e.wins > 5,
          recentWins: e.recentWins
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    if (result.length > 0) {
      const { error } = await supabaseAdmin
        .from('whales_cache')
        .upsert({ id: 1, data: result, updated_at: new Date().toISOString() });
      if (error) throw error;
    }

    return NextResponse.json({ success: true, count: result.length, pools_scanned: pools.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
