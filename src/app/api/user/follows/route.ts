import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

// GET /api/user/follows?address=<wallet>
// Returns the list of whale usernames the user is following.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) return NextResponse.json({ follows: [], activity: [] });

  const [followsRes, activityRes] = await Promise.all([
    supabaseAdmin
      .from('user_follows')
      .select('whale_username')
      .eq('user_address', address)
      .eq('is_active', true),
    supabaseAdmin
      .from('mirror_activity')
      .select('*')
      .eq('user_address', address)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    follows: followsRes.data?.map((f: any) => f.whale_username) ?? [],
    activity: activityRes.data ?? [],
  });
}

// POST /api/user/follows
// Body: { address: string; whale: string; maxStake?: number }
// Toggles follow state — inserts if not following, deletes if already following.
export async function POST(req: NextRequest) {
  const { address, whale, maxStake = 0.1 } = await req.json();
  if (!address || !whale) {
    return NextResponse.json({ error: 'Missing address or whale' }, { status: 400 });
  }

  // Check current state
  const { data: existing } = await supabaseAdmin
    .from('user_follows')
    .select('id')
    .eq('user_address', address)
    .eq('whale_username', whale)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('user_follows')
      .delete()
      .eq('user_address', address)
      .eq('whale_username', whale);
    return NextResponse.json({ following: false });
  } else {
    await supabaseAdmin
      .from('user_follows')
      .insert([{ user_address: address, whale_username: whale, max_stake: maxStake, is_active: true }]);
    return NextResponse.json({ following: true });
  }
}
