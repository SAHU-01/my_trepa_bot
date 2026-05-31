import { NextResponse } from 'next/server';
import { credentialsFromEnv, Trepa } from '@trepa/sdk';

export const dynamic = 'force-dynamic';

const trepa = new Trepa({ credentials: credentialsFromEnv() });

// Debug endpoint — dumps raw Trepa API responses to diagnose pool detection
// Visit: /api/debug
export async function GET() {
  const result: any = {};

  try {
    const streak = await trepa.streaks.bitcoin();
    result.streak = streak;

    if (streak?.id) {
      const [details, poolsRaw] = await Promise.all([
        trepa.streaks.poolDetails(streak.id),
        trepa.streaks.pools(streak.id, { limit: 5 } as any),
      ]);
      result.poolDetails = details;
      result.poolsRaw = poolsRaw;
      result.currentPool = details?.current_pool ?? null;
      result.nextPool = details?.next_pool ?? null;
      result.recentPools = (poolsRaw as any)?.pools ?? poolsRaw;
    }
  } catch (e: any) {
    result.error = e.message;
  }

  return NextResponse.json(result);
}
