import { Trepa, credentialsFromEnv } from '@trepa/sdk';
import fs from 'fs';

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

async function inspectPredictionUser() {
  try {
    const streak = await trepa.streaks.bitcoin();
    const pools: any = await trepa.streaks.pools(streak.id, { limit: 1 });
    const pool = pools[0] || pools.pools[0];
    
    console.log(`Checking predictions for pool ${pool.id}...`);
    const predictions: any = await trepa.pools.predictions(pool.id, { limit: 1, includes: ['user'] });
    
    console.log('Prediction User Object:', JSON.stringify(predictions[0]?.user, null, 2));

  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

inspectPredictionUser();
