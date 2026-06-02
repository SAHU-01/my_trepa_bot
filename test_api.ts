import { Trepa, credentialsFromEnv } from '@trepa/sdk'
import fs from 'fs'

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

async function test() {
  try {
    console.log("Testing streaks.bitcoin()...");
    const streak = await trepa.streaks.bitcoin();
    console.log("Success:", streak?.id);
    
    console.log("Testing pools.list()...");
    const pools = await trepa.pools.list({ filter_by: ['ACTIVE'] as any, streak_id: streak.id, limit: 1 } as any);
    console.log("Success, found:", pools.length);
  } catch (e: any) {
    console.error("Error:", e.message || e);
  }
}

test();
