import { NextResponse } from 'next/server';
import { getActiveBitcoinPool, trepa } from '@/services/trepaClient';
import { supabase, logAudit } from '@/services/supabaseClient';

/**
 * WHALE MIRROR ENGINE (Triggered via Cron)
 * 
 * 1. Finds active Flash Pool.
 * 2. Scans for new predictions from Whales.
 * 3. Finds users following those Whales.
 * 4. Executes/Logs the mirrored prediction.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  // Simple security check for Cron trigger
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const results = {
    scanned: 0,
    mirrored: 0,
    errors: [] as string[]
  };

  try {
    // 1. Get Active Pool
    const { pool } = await getActiveBitcoinPool();
    if (!pool) return NextResponse.json({ message: 'No active pool' });

    // 2. Fetch all predictions for this pool
    const predictions = await trepa.pools.predictions(pool.id, { limit: 50, includes: ['user'] });
    results.scanned = predictions.length;

    // 3. Find active followers in our database
    const { data: followers, error: followError } = await supabase
      .from('user_follows')
      .select('*')
      .eq('is_active', true);

    if (followError) throw followError;

    // 4. Process Mirroring
    for (const prediction of predictions) {
      const whaleUsername = prediction.user?.username;
      if (!whaleUsername) continue;

      // Find users following this specific whale
      const relevantFollowers = followers.filter(f => f.whale_username === whaleUsername);
      
      for (const follower of relevantFollowers) {
        // Check if we already mirrored this pool for this user
        const { data: existing } = await supabase
          .from('mirror_activity')
          .select('id')
          .eq('user_address', follower.user_address)
          .eq('pool_id', pool.id)
          .maybeSingle();

        if (existing) continue;

        // EXECUTION LOGIC:
        // In a real production setup, we would call Privy Server Wallet API here.
        // For the Arena Prototype, we log the "Mirror Intent" and record the trade activity.
        const forecastValue = Number(prediction.prediction);
        const stakeAmount = Math.min(Number(follower.max_stake), Number(pool.max_stake || 10));

        try {
          const { error: activityError } = await supabase
            .from('mirror_activity')
            .insert([{
              user_address: follower.user_address,
              whale_username: whaleUsername,
              pool_id: pool.id,
              forecast_value: forecastValue,
              stake_amount: stakeAmount,
              status: 'SUCCESS', // Marked as success once the intent is recorded
              tx_hash: 'SIMULATED_' + Math.random().toString(36).substring(7)
            }]);

          if (activityError) throw activityError;
          results.mirrored++;
          
          logAudit({
            event_type: 'TRADE_EXECUTION',
            method: 'MIRROR',
            endpoint: whaleUsername,
            status: 200,
            payload: { follower: follower.user_address, whale: whaleUsername, value: forecastValue },
            duration_ms: Date.now() - start
          });
        } catch (e: any) {
          results.errors.push(`Failed for ${follower.user_address}: ${e.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      duration: Date.now() - start
    });

  } catch (error: any) {
    logAudit({
      event_type: 'ERROR',
      method: 'MIRROR_TRIGGER',
      endpoint: 'engine',
      status: 500,
      response: { message: error.message }
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
