import { NextRequest, NextResponse } from 'next/server';
import { mirrorForecast } from '@/services/trepaClient';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolId = searchParams.get('poolId');

  if (!poolId) {
    return NextResponse.json({ error: 'poolId is required' }, { status: 400 });
  }

  try {
    const data = await mirrorForecast(poolId);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in mirror forecast API:', error);
    return NextResponse.json({ error: 'Failed to fetch mirror forecast' }, { status: 500 });
  }
}
