import { Trepa } from '@trepa/sdk'
import fs from 'fs'
import path from 'path'

// Manual .env parser
const envPath = './.env';
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const trepa = new Trepa({ 
  credentials: [{
    apiKey: process.env.TREPA_API_KEY || '',
    privateKey: process.env.TREPA_PRIVATE_KEY || ''
  }]
});

const CACHE_FILE = './whales_cache.json';

async function forcePopulateCache() {
  console.log('🚀 FORCING WHALE CACHE POPULATION...');
  try {
    const bitcoinStreak = await trepa.streaks.bitcoin();
    console.log(`✅ STREAK: ${bitcoinStreak.id}`);
    
    // DEEP SCAN: Fetch last 100 pools to find as many resolved rounds as possible
    const poolsRaw: any = await trepa.streaks.pools(bitcoinStreak.id, { limit: 100 });
    const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.pools || poolsRaw?.data || []);
    
    console.log(`✅ FOUND ${pools.length} POOLS (DEEP SCAN)`);
    
    if (pools.length === 0) {
        console.log('❌ NO POOLS FOUND.');
        return;
    }

    const expertStats = new Map<string, { 
      username: string; 
      uid: string;
      wins: number; 
      totalStaked: number;
      accuracies: number[];
      poolCount: number;
    }>();
    
    // Process pools in batches of 10 to be polite to the API
    for (let i = 0; i < pools.length; i += 10) {
      const batch = pools.slice(i, i + 10);
      const batchPredictions = await Promise.all(
        batch.map(pool => trepa.pools.predictions(pool.id, { limit: 20, includes: ['user'] }))
      );
      
      batchPredictions.forEach((predictions: any) => {
        if (!Array.isArray(predictions) || predictions.length === 0) return;
        
        // RELATIVE WIN LOGIC: A win is defined as being in the top 3 or top 10% of that round
        const sorted = predictions
          .filter(p => (Number(p.precision) || 0) > 0)
          .sort((a, b) => Number(b.precision) - Number(a.precision));
        
        const winThreshold = sorted[Math.floor(sorted.length * 0.1)]?.precision || sorted[0]?.precision || 100;

        predictions.forEach(p => {
          const username = p.user?.username || `anon-${p.predictor_account.slice(0, 4)}`;
          const uid = p.user?.id || p.predictor_account;
          const stake = Number(p.stake) || 0;
          const precision = Number(p.precision) || 0;
          const existing = expertStats.get(username);
          
          const isWin = precision > 0 && precision >= winThreshold;

          if (existing) {
            existing.wins += isWin ? 1 : 0;
            existing.totalStaked += stake;
            existing.accuracies.push(precision);
            existing.poolCount += 1;
          } else {
            expertStats.set(username, {
              username,
              uid,
              wins: isWin ? 1 : 0,
              totalStaked: stake,
              accuracies: [precision],
              poolCount: 1
            });
          }
        });
      });
      console.log(`⏳ Progress: ${Math.min(i + 10, pools.length)}/${pools.length} pools scanned...`);
    }
    
    const result = [...expertStats.values()]
      .map((e) => {
        const avgPrecision = e.accuracies.reduce((a, b) => a + b, 0) / e.accuracies.length;
        const winRate = (e.wins / e.poolCount) * 100;

        // SCORING: Total Wins * 50 + Total Staked * 10 + Win Rate * 2 + Avg Precision
        const score = (e.wins * 50) + (e.totalStaked * 10) + (winRate * 2) + avgPrecision;
        
        return {
          username: e.username,
          wins: e.wins,
          totalStaked: e.totalStaked,
          winRate: Math.round(winRate),
          avgPrecision: Math.round(avgPrecision),
          score: Math.round(score),
          isWhale: e.totalStaked > 10 || e.wins > 5
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15); // Show more on the radar

    if (result.length > 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
      console.log(`\n✅ CACHE POPULATED: ${CACHE_FILE}`);
      console.log('\n--- 🏅 WHALE RESULTS ---');
      result.slice(0, 10).forEach((w, i) => {
        console.log(`${i+1}. @${w.username.padEnd(20)} | WINS: ${w.wins} | STAKED: ${w.totalStaked.toFixed(2)} SOL`);
      });
      console.log('------------------------\n');
    } else {
        console.log('⚠️ NO RESULTS TO CACHE.');
    }
    
  } catch (error) {
    console.error('❌ CACHE POPULATION FAILED:', error);
  }
}

forcePopulateCache();
