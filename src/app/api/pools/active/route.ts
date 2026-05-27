import { NextResponse } from 'next/server';
import { getActiveBitcoinPool, getNextSessionTime } from '@/services/trepaClient';

export async function GET() {
  try {
    const { pool, expertCount } = await getActiveBitcoinPool();
    const nextSessionAt = getNextSessionTime();
    return NextResponse.json({ pool, nextSessionAt, expertCount });
  } catch (error) {
    console.error('Error fetching active pool:', error);
    return NextResponse.json({ error: 'Failed to fetch active pool' }, { status: 500 });
  }
}
