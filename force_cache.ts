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
  credentials: {
    apiKey: process.env.TREPA_API_KEY || '',
    privateKey: process.env.TREPA_PRIVATE_KEY || ''
  }
});

const CACHE_FILE = './whales_cache.json';

async function forcePopulateCache() {
  console.log('🚀 FORCING WHALE CACHE POPULATION...');
  try {
    const bitcoinStreak = await trepa.streaks.bitcoin();
    console.log(`✅ STREAK: ${bitcoinStreak.id}`);
    
    const poolsRaw: any = await trepa.streaks.pools(bitcoinStreak.id, { limit: 15 });
    const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.pools || poolsRaw?.data || []);
    
    console.log(`✅ FOUND ${pools.length} POOLS`);
    
    if (pools.length === 0) {
        console.log('❌ NO POOLS FOUND.');
        return;
    }

    const expertStats = new Map<string, { 
      username: string; 
      wins: number; 
      totalStaked: number;
      accuracies: number[];
    }>();
    
    const allPredictions = await Promise.all(
      pools.map(pool => trepa.pools.predictions(pool.id, { limit: 10, includes: ['user'] }))
    );
    
    allPredictions.forEach((predictions: any) => {
      if (!Array.isArray(predictions)) return;
      predictions.forEach(p => {
        const username = p.user?.username || `anon-${p.predictor_account.slice(0, 4)}`;
        const stake = Number(p.stake) || 0;
        const precision = Number(p.precision) || 0;
        const existing = expertStats.get(username);
        
        if (existing) {
          existing.wins += (precision > 90) ? 1 : 0;
          existing.totalStaked += stake;
          existing.accuracies.push(precision);
        } else {
          expertStats.set(username, {
            username,
            wins: (precision > 90) ? 1 : 0,
            totalStaked: stake,
            accuracies: [precision]
          });
        }
      });
    });
    
    const result = [...expertStats.values()]
      .map(e => {
        const avgPrecision = e.accuracies.reduce((a, b) => a + b, 0) / e.accuracies.length;
        const winRate = (e.wins / e.accuracies.length) * 100;
        const score = (e.wins * 50) + (e.totalStaked * 10) + (avgPrecision * 2);
        
        return {
          username: e.username,
          wins: e.wins,
          totalStaked: e.totalStaked,
          winRate: Math.round(winRate),
          avgPrecision: Math.round(avgPrecision),
          score,
          isWhale: e.totalStaked > 15 
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (result.length > 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
      console.log(`\n✅ CACHE POPULATED: ${CACHE_FILE}`);
      console.log('\n--- 🏅 WHALE RESULTS ---');
      result.forEach((w, i) => {
        console.log(`${i+1}. @${w.username.padEnd(20)} | WIN RATE: ${w.winRate}% | STAKED: ${w.totalStaked.toFixed(2)} SOL`);
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
