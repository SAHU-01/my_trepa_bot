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

async function debugPrecision() {
  console.log('🚀 DEBUGGING PRECISION VALUES...');
  try {
    const poolId = "c9a11a94-d581-472a-8b5b-4d8d4e5d906c";
    const predictions: any = await trepa.pools.predictions(poolId, { limit: 5, includes: ['user'] });
    
    console.log(`\n--- RAW PREDICTION DATA ---`);
    predictions.forEach((p: any) => {
        console.log(`User: @${p.user?.username} | Precision: ${p.precision} (Type: ${typeof p.precision})`);
    });
    
  } catch (error: any) {
    console.error('❌ DEBUG FAILED:', error.message);
  }
}

debugPrecision();
