import { credentialsFromEnv, Trepa } from '@trepa/sdk'

const trepa = new Trepa({ credentials: credentialsFromEnv() })

// ---------- pretty logger ----------
const C = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

const log = async (tag: string, msg: string) => {
  const t = new Date().toISOString().slice(11, 19)
  console.log(`${C.dim(`[${t}]`)} ${C.yellow(tag.padEnd(10))} ${msg}`)
  
  // Also report to dashboard API if running
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${siteUrl}/api/bot/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, message: msg }),
    })
  } catch {
    // Dashboard not running, ignore
  }
}

// ---------- precision score cache ----------
const scoreCache = new Map<string, number>()

async function getPrecisionScore(userId: string): Promise<number> {
  if (scoreCache.has(userId)) return scoreCache.get(userId)!
  try {
    const stats: any = await trepa.users.statistics(userId)
    const score =
      stats?.precision_score ??
      stats?.precisionScore ??
      stats?.average_precision_score ??
      stats?.averagePrecisionScore ??
      stats?.score ??
      0
    scoreCache.set(userId, Number(score) || 0)
    return scoreCache.get(userId)!
  } catch {
    scoreCache.set(userId, 0)
    return 0
  }
}

// ---------- BTC spot fallback ----------
async function btcSpot(): Promise<number> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { price } = (await res.json()) as { price: string }
    return Number(price)
  } catch (err) {
    log('ERROR', C.red(`Binance fetch failed: ${err}`))
    return 0
  }
}

// ---------- the mirror logic ----------
async function mirrorForecast(poolId: string, myUserId: string, logger?: (tag: string, msg: string) => void): Promise<number | null> {
  const useLog = logger || log

  let predictions: any[] = []
  try {
    // Use the new straightforward predictions endpoint from @trepa/sdk v0.2.x
    // Limit to 20 to avoid overloading the API
    predictions = await trepa.pools.predictions(poolId, { limit: 20, includes: ['user'] })
  } catch (err) {
    useLog('ERROR', C.red(`Mirror fetch failed: ${err}`))
    return null
  }

  const others = predictions.filter(
    p => p?.user?.id !== myUserId && p?.predictor_account !== myUserId
  )
  if (others.length === 0) return null

  const uniqueByUser = new Map<string, any>()
  for (const p of others) {
    const uid = p?.user?.id ?? p?.predictor_account
    if (!uid) continue
    const existing = uniqueByUser.get(uid)
    if (!existing || new Date(p.updated_at) > new Date(existing.updated_at)) {
      uniqueByUser.set(uid, p)
    }
  }

  const scored = await Promise.all(
    [...uniqueByUser.entries()].map(async ([uid, p]) => {
      const value = Number(p.value ?? p.prediction)
      const score = await getPrecisionScore(uid)
      return { uid, value: isNaN(value) ? 0 : value, score }
    })
  )

  const TOP_N = 5
  const top = scored
    .filter(x => x.value > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)

  if (top.length === 0) return null

  const totalScore = top.reduce((s, x) => s + x.score, 0)
  const aggregate =
    totalScore > 0
      ? top.reduce((s, x) => s + x.value * x.score, 0) / totalScore
      : top.reduce((s, x) => s + x.value, 0) / top.length

  useLog('MIRROR', `${C.bold(`top ${top.length}`)} experts found → ${C.green('$' + aggregate.toLocaleString())}`)
  for (const t of top) {
    useLog('  ↳', `score=${String(t.score).padStart(4)}  forecast=$${t.value.toLocaleString()}  uid=${C.dim(t.uid.slice(0, 8))}`)
  }
  return aggregate
}

// ---------- the bot ----------
;(async () => {
  await trepa.bots.run({
    predict: async (pool, ctx) => {
      const logger = (ctx && (ctx as any).log) ? (tag: string, msg: string) => (ctx as any).log(`[${tag}] ${msg}`) : log
      logger('ROUND', `${C.bold(pool.title)}  closes ${new Date(pool.prediction_end_date).toLocaleTimeString()}`)

      const mirrored = await mirrorForecast(pool.id, ctx.me.id, logger)

      if (mirrored === null) {
        const spot = await btcSpot()
        logger('FALLBACK', `no peers yet → spot $${spot.toFixed(2)}`)
        return { value: spot, stake: pool.min_stake }
      }
      return { value: mirrored, stake: pool.min_stake }
    },

    updatePrediction: async (info, ctx) => {
      const logger = (ctx && (ctx as any).log) ? (tag: string, msg: string) => (ctx as any).log(`[${tag}] ${msg}`) : log
      const msUntilClose = new Date(info.pool.prediction_end_date).getTime() - Date.now()
      const sleep = Math.max(0, msUntilClose - 3_000)
      logger('WAIT', `re-mirroring in ${(sleep / 1000).toFixed(1)}s`)
      await new Promise(r => setTimeout(r, sleep))

      const fresh = await mirrorForecast(info.pool.id, ctx.me.id, logger)
      if (fresh === null) return null
      if (Math.abs(fresh - info.value) < (info.pool as any).step) {
        logger('NO REVISE', `Δ too small — keeping $${info.value.toFixed(2)}`)
        return null
      }
      return { value: fresh }
    },

    onStart: () => { log('START', C.green('Mirror Bot online — alpha is the network')) },
    onPredicted: ({ pool, value }) => { log('SUBMITTED', `${C.green('✓')} $${value}`) },
    onPredictionUpdated: ({ previousValue, value }) => {
      log('UPDATED', `$${previousValue} → ${C.green('$' + value)}`)
    },
    onPoolSkipped: ({ pool }) => { log('SKIP', pool?.title ?? '(no pool)') },
    onError: (err) => { log('ERROR', C.red(String(err))) },
  })
})()