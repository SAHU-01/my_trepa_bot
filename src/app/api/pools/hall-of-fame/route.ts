import { NextResponse } from 'next/server';
import { getHallOfFame } from '@/services/trepaClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const winners = await getHallOfFame();
    return NextResponse.json({ winners }, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      }
    });
  } catch (error) {
    console.error('Error in Hall of Fame API:', error);
    return NextResponse.json({ error: 'Failed to fetch Hall of Fame' }, { status: 500 });
  }
}
