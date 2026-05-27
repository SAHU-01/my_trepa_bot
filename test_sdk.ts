import { Trepa, credentialsFromEnv } from '@trepa/sdk'
import fs from 'fs'

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

const trepa = new Trepa({ credentials: credentialsFromEnv() });

async function getWhaleDetails() {
  console.log('🚀 FETCHING ACTUAL WHALE DATA FROM LAST RESOLVED POOL...');
  try {
    const poolId = "c9a11a94-d581-472a-8b5b-4d8d4e5d906c";
    console.log(`🔍 POOL: ${poolId}`);
    
    // We know 'predictions' works and includes user metadata
    const predictions: any = await trepa.pools.predictions(poolId, { limit: 10, includes: ['user'] });
    
    if (Array.isArray(predictions) && predictions.length > 0) {
      // Sort by accuracy manually since it's a resolved pool
      const sorted = predictions
        .filter((p: any) => p.precision !== null)
        .sort((a: any, b: any) => b.precision - a.precision)
        .slice(0, 5);

      console.log('\n--- 🏅 TOP WHALES FOUND ---');
      sorted.forEach((p, i) => {
        console.log(`${i+1}. @${(p.user?.username || 'anon').padEnd(20)} | PRECISION: ${p.precision}% | STAKE: ${p.stake} SOL`);
      });
      console.log('---------------------------\n');
      
      // Fetch stats for the top one
      const topWhale = sorted[0];
      const uid = topWhale.user?.id || topWhale.predictor_account;
      
      console.log(`📡 FETCHING DEEP INTEL FOR @${topWhale.user?.username || 'anon'} (${uid})...`);
      const stats: any = await trepa.users.statistics(uid);
      
      console.log('\n--- 🐋 DEEP INTEL ---');
      console.log(`PNL:       ${stats.pnl} SOL`);
      console.log(`VOLUME:    ${stats.volume} SOL`);
      console.log(`WINS:      ${stats.wins}`);
      console.log(`WIN RATE:  ${stats.win_rate}%`);
      console.log('---------------------------\n');
      
    } else {
      console.log('⚠️ No predictions found for this pool.');
    }
    
  } catch (error: any) {
    console.error('❌ ERROR:', error.message || error);
  }
}

getWhaleDetails();
