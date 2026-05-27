'use client';

import React, { useState, useEffect } from 'react';
import PredictionSlider from '@/components/PredictionSlider';
import { Cpu, Users, User, Zap, Terminal } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function PredictionArena() {
  const [userPrediction, setUserPrediction] = useState(65000);
  const [currentPrice, setCurrentPrice] = useState(65000);
  const [range, setRange] = useState({ min: 60000, max: 70000 });
  const [mirrorPrediction, setMirrorPrediction] = useState<number | null>(null);
  const [topPredictors, setTopPredictors] = useState<any[]>([]);
  const [aiPrediction, setAiPrediction] = useState<number | null>(null);
  const [aiHeadlines, setAiHeadlines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [botLogs, setBotLogs] = useState<any[]>([]);
  const [activePool, setActivePool] = useState<any>(null);
  const [expertCount, setExpertCount] = useState(0);
  const [nextSessionAt, setNextSessionAt] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [poolTimeLeft, setPoolTimeLeft] = useState<number | null>(null);
  const [hallOfFame, setHallOfFame] = useState<any[]>([]);
  const [selectedWhale, setSelectedWhale] = useState<any>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  // Fetch Hall of Fame on mount with polling
  useEffect(() => {
    const fetchHallOfFame = async () => {
      try {
        const res = await fetch('/api/pools/hall-of-fame');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setHallOfFame(data.winners || []);
      } catch (e: any) {
        console.error('Failed to fetch Hall of Fame:', e.message);
      }
    };
    fetchHallOfFame();
    const interval = setInterval(fetchHallOfFame, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch data and handle pool transitions
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Fetch BTC price
        const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        if (!priceRes.ok) throw new Error(`Binance HTTP ${priceRes.status}`);
        const priceData = await priceRes.json();
        const price = parseFloat(priceData.price);
        
        if (isNaN(price)) {
          console.warn('Invalid BTC price received from Binance');
        } else {
          setCurrentPrice(price);
          
          // Only update initial slider value if the user hasn't started results yet
          if (!showResults && !isSubmitting) {
            setUserPrediction(prev => {
              // Only snap if the current prediction is far away (e.g. first load)
              if (Math.abs(prev - price) > 1000) return Math.round(price);
              return prev;
            });
            setRange({ min: Math.round(price * 0.8), max: Math.round(price * 1.2) });
          }
        }

        // 2. Fetch active Trepa pool
        const poolRes = await fetch('/api/pools/active');
        if (!poolRes.ok) throw new Error(`Pool API HTTP ${poolRes.status}`);
        const data = await poolRes.json();
        
        // CRITICAL: Check for Pool Transition
        if (data.pool && activePool && data.pool.id !== activePool.id) {
          console.log("New Flash Pool detected! Resetting dashboard...");
          // Handle Recap of the previous pool
          setLastResult({
            poolTitle: activePool.title,
            finalPrice: price,
            userPrediction,
            mirrorPrediction,
            mvp: topPredictors[0]
          });

          setShowResults(false);
          setMirrorPrediction(null);
          setTopPredictors([]);
          setAiPrediction(null);
          setUserPrediction(Math.round(price));
        }

        setActivePool(data.pool || null);
        setExpertCount(data.expertCount || 0);
        setNextSessionAt(data.nextSessionAt || null);

        if (data.pool && data.pool.prediction_end_date) {
          const endTime = new Date(data.pool.prediction_end_date).getTime();
          const nowTime = new Date().getTime();
          const timeLeft = Math.max(0, Math.floor((endTime - nowTime) / 1000));
          
          if (!isNaN(timeLeft)) {
            setPoolTimeLeft(timeLeft);
          } else {
            setPoolTimeLeft(null);
          }
        } else {
          setPoolTimeLeft(null);
        }
      } catch (e: any) {
        console.error('Failed to sync with market:', e.message || e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Sync every 5 seconds for Flash Pools
    return () => clearInterval(interval);
  }, [activePool, showResults, isSubmitting, userPrediction, mirrorPrediction, topPredictors]);

  // Pool Countdown Tick
  useEffect(() => {
    if (poolTimeLeft === null || poolTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setPoolTimeLeft(prev => (prev !== null && prev > 0) ? prev - 1 : 0);
    }, 1000);
    return () => clearInterval(timer);
  }, [poolTimeLeft]);

  // Live Countdown logic
  useEffect(() => {
    if (!nextSessionAt) return;

    const updateCountdown = () => {
      const now = new Date().getTime();
      const target = new Date(nextSessionAt).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setCountdown("LIVE SOON");
        return;
      }

      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdown(`${h}H : ${m}M : ${s}S`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextSessionAt]);

  // Fetch bot logs
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/bot/logs');
        const data = await res.json();
        setBotLogs(data.logs || []);
      } catch (e) {}
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleFetchPredictions = async () => {
    if (isNaN(userPrediction)) {
      console.error('Cannot submit: Invalid prediction value');
      return;
    }
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSubmitting(false);
    setIsLoading(true);
    setShowResults(true);
    
    try {
      // In Warm-up Mode (no active pool), we only fetch AI forecast
      const requests = [
        fetch(`/api/forecast/ai?symbol=BTC&currentPrice=${userPrediction}`)
      ];

      if (activePool) {
        requests.push(fetch(`/api/forecast/mirror?poolId=${activePool.id}`));
      }

      const responses = await Promise.all(requests);
      const aiData = await responses[0].json();
      setAiPrediction(aiData.prediction);
      setAiHeadlines(aiData.headlines || []);

      if (activePool && responses[1]) {
        const mirrorData = await responses[1].json();
        setMirrorPrediction(mirrorData.prediction);
        setTopPredictors(mirrorData.topPredictors || []);
      }
    } catch (error) {
      console.error('Failed to fetch predictions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMirrorLock = () => {
    if (mirrorPrediction) {
      setUserPrediction(Math.round(mirrorPrediction));
    }
  };

  return (
    <div className="h-screen p-4 md:p-6 flex flex-col space-y-4 bg-[#0a0a0a] overflow-hidden">
      {/* Navbar / Header */}
      <header className="flex-none w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="text-center md:text-left space-y-1">
          <h1 className="text-2xl md:text-4xl font-black pixel-header neon-text flex items-center justify-center md:justify-start gap-4">
            <Terminal className="w-6 h-6 text-emerald-500" />
            TREPA ARENA
          </h1>
          <p className="text-emerald-400 font-mono text-[9px] tracking-[0.3em] uppercase">
            Precision Simulation // Mirror Intelligence
          </p>
        </div>

        {/* Live Status Badge */}
        <div className="flex flex-col items-center md:items-end gap-1">
          <div className={cn(
            "px-4 py-1.5 rounded-full border flex items-center gap-3 font-mono text-[10px] transition-all relative overflow-hidden",
            activePool 
              ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400" 
              : "bg-amber-500/10 border-amber-500/30 text-amber-400"
          )}>
            {/* Progress bar background for active pool */}
            {activePool && poolTimeLeft !== null && (
              <div 
                className="absolute left-0 top-0 bottom-0 bg-emerald-500/10 transition-all duration-1000 ease-linear"
                style={{ width: `${(poolTimeLeft / 60) * 100}%` }}
              />
            )}
            <span className={cn("w-1.5 h-1.5 rounded-full z-10", activePool ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
            <div className="flex items-center gap-2 z-10">
              {activePool ? (
                <>
                  <span className={cn(poolTimeLeft !== null && poolTimeLeft < 15 ? "text-red-500 font-bold" : "")}>
                    {poolTimeLeft !== null ? `${poolTimeLeft}S UNTIL LOCK` : 'MARKET LIVE'}
                  </span>
                  <span className="border-l border-white/10 pl-2 text-[8px] opacity-70">
                    {expertCount > 4 ? "EXPERTS: READY" : expertCount > 0 ? "EXPERTS: SYNCING" : "EXPERTS: AWAITING"}
                  </span>
                </>
              ) : "WARM-UP MODE"}
              {!activePool && countdown && (
                <span className="border-l border-white/10 pl-3 ml-1 font-bold text-white tracking-widest">{countdown}</span>
              )}
            </div>
          </div>
          <p className="text-[8px] text-gray-500 uppercase tracking-tighter">
            {activePool ? `Signal Strength: ${expertCount > 4 ? "Full (High)" : expertCount > 0 ? "Partial" : "Zero"}` : "Next Session: 13:00 UTC Daily"}
          </p>
        </div>
      </header>

      {/* Main Layout Area */}
      <main className="flex-1 min-h-0 w-full max-w-[1600px] mx-auto overflow-hidden px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full pb-4">
          
          {/* Column 1: Whale Radar (Global Discovery) */}
          <section className="glass p-4 rounded-2xl flex flex-col space-y-4 neon-border overflow-hidden bg-black/20">
            <div className="flex items-center justify-between text-[10px] font-mono text-emerald-500 uppercase tracking-widest border-b border-white/5 pb-2">
              <span className="flex items-center gap-2">
                <Users className="w-3 h-3" />
                Whale Radar
              </span>
              <span className="text-[8px] opacity-50">Scanning History</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
              {hallOfFame.length > 0 ? (
                hallOfFame.map((whale, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedWhale(whale)}
                    className={cn(
                      "w-full text-left p-3 rounded-xl border transition-all group relative overflow-hidden",
                      selectedWhale?.username === whale.username 
                        ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
                        : "bg-white/5 border-white/5 hover:border-white/20"
                    )}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[10px] font-bold text-white group-hover:text-emerald-400 transition-colors">{whale.username}</span>
                      {whale.isWhale && <Zap className="w-2.5 h-2.5 text-amber-500 animate-pulse" />}
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="text-[8px] font-mono text-gray-500 uppercase">Success Rate</div>
                      <div className="text-[10px] font-mono text-emerald-500">{whale.wins} WINS</div>
                    </div>
                    <div className="w-full h-0.5 bg-white/5 mt-1.5 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/40" style={{ width: `${(whale.wins / 12) * 100}%` }} />
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-10 space-y-2 opacity-30">
                  <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto" />
                  <p className="text-[8px] font-mono uppercase">Scanning History...</p>
                </div>
              )}
            </div>

            {/* Selected Whale Details Card */}
            {selectedWhale && (
              <div className="flex-none p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30 animate-in slide-in-from-bottom-2 duration-300">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-[9px] font-mono text-emerald-400 uppercase font-bold tracking-tighter">Deep Intel: {selectedWhale.username}</p>
                  <button onClick={() => setSelectedWhale(null)} className="text-gray-500 hover:text-white transition-colors">×</button>
                </div>
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-black/40 rounded border border-white/5">
                      <p className="text-[7px] text-gray-500 uppercase mb-0.5">Win Rate</p>
                      <p className="text-[11px] font-mono text-emerald-400 font-bold">{selectedWhale.winRate}%</p>
                    </div>
                    <div className="p-2 bg-black/40 rounded border border-white/5">
                      <p className="text-[7px] text-gray-500 uppercase mb-0.5">Avg Precision</p>
                      <p className="text-[11px] font-mono text-emerald-400 font-bold">{selectedWhale.avgPrecision}%</p>
                    </div>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono uppercase">
                    <span className="text-gray-500 font-bold">Total Conviction</span>
                    <span className="text-white font-bold">{selectedWhale.totalStaked.toFixed(2)} SOL</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono uppercase">
                    <span className="text-gray-500 font-bold">Market Tier</span>
                    <span className="text-amber-500 font-bold">{selectedWhale.isWhale ? 'MARKET WHALE' : 'EXPERT'}</span>
                  </div>
                  <div className="p-2 bg-black/40 rounded border border-white/5 text-[8px] text-gray-400 leading-tight italic">
                    Scored as {selectedWhale.score.toLocaleString()} based on 30-pool volume and historical precision density.
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Column 2-3: Precision Hub (Input & Main Visuals) */}
          <section className="lg:col-span-2 glass p-6 md:px-10 md:py-6 rounded-2xl flex flex-col justify-between neon-border relative overflow-hidden bg-black/40">
            {/* Last Result Recap Overlay */}
            {lastResult && !showResults && (
              <div className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center p-6 animate-in fade-in duration-500">
                <div className="max-w-md w-full glass p-8 rounded-2xl border border-emerald-500/30 text-center space-y-6">
                  <div className="space-y-1">
                    <p className="text-[10px] font-mono text-emerald-500/50 uppercase tracking-[0.2em]">Last Round Resolved</p>
                    <h3 className="text-2xl font-black text-white">{lastResult.poolTitle}</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-[8px] font-mono text-gray-500 uppercase mb-1">Actual Price</p>
                      <p className="text-xl font-mono text-white">${lastResult.finalPrice.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                      <p className="text-[8px] font-mono text-emerald-400 uppercase mb-1">Mirror Bot</p>
                      <p className="text-xl font-mono text-emerald-400">
                        ${lastResult.mirrorPrediction?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 'N/A'}
                      </p>
                    </div>
                  </div>

                  {lastResult.mvp && (
                    <div className="p-4 rounded-xl border border-white/5 bg-black/40">
                      <p className="text-[8px] font-mono text-amber-500/60 uppercase mb-2">🏅 MVP Expert (Closest)</p>
                      <div className="flex justify-between items-center px-2">
                        <span className="text-sm font-bold text-white">{lastResult.mvp.username}</span>
                        <span className="text-sm font-mono text-amber-400">${lastResult.mvp.forecast.toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={() => setLastResult(null)}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition-all"
                  >
                    READY FOR NEXT DRILL
                  </button>
                </div>
              </div>
            )}

            {/* Subtle background guide */}
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <Zap className="w-32 h-32 text-emerald-500" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-300 font-mono text-[9px] uppercase tracking-widest">
                  {activePool ? (
                    <>Pool: {activePool.title} • SPOT: ${currentPrice.toLocaleString()}</>
                  ) : (
                    <>Trepa Markets Closed • Practice on Real-Time Spot</>
                  )}
                </div>
                {activePool && mirrorPrediction && (
                  <button 
                    onClick={handleMirrorLock}
                    className="flex items-center gap-2 px-3 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all group"
                  >
                    <Users className="w-3 h-3 group-hover:scale-110 transition-transform" />
                    MIRROR LOCK: ${Math.round(mirrorPrediction).toLocaleString()}
                  </button>
                )}
              </div>
              <h2 className="text-2xl font-bold text-white">1. Define Your Forecast</h2>
              <p className="text-gray-400 text-[11px] max-w-md leading-tight">
                Observe the Top Experts and Mirror Bot signal on the right. Calibrate your target and commit before the lock.
              </p>
            </div>

            <div className="py-2 flex-1 flex flex-col justify-center">
              <PredictionSlider 
                min={range.min} 
                max={range.max} 
                step={1} 
                currentPrice={currentPrice}
                initialValue={userPrediction} 
                onChange={setUserPrediction} 
              />
            </div>

            <div className="space-y-4">
              <button
                onClick={handleFetchPredictions}
                disabled={isLoading || isSubmitting || (activePool && poolTimeLeft !== null && poolTimeLeft < 2)}
                className={cn(
                  "w-full py-4 rounded-lg font-bold text-lg transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.99] relative overflow-hidden",
                  activePool 
                    ? "bg-gradient-to-r from-emerald-600 to-lime-600 text-white shadow-[0_0_20px_rgba(57,255,20,0.3)]"
                    : "bg-gradient-to-r from-emerald-900 to-emerald-700 text-emerald-100 opacity-90 border border-emerald-500/30 shadow-[0_0_15px_rgba(57,255,20,0.1)]",
                  (isLoading || isSubmitting) ? "opacity-50 cursor-not-allowed" : ""
                )}
              >
                {isSubmitting ? 'CALIBRATING...' : isLoading ? 'SYNCING NETWORK...' : activePool ? (poolTimeLeft !== null && poolTimeLeft < 5 ? 'LOCKING IN...' : 'SUBMIT TO ARENA') : 'START WARM-UP FORECAST'}
                
                {activePool && poolTimeLeft !== null && (
                  <div 
                    className="absolute left-0 bottom-0 h-1 bg-white/30 transition-all duration-1000 ease-linear"
                    style={{ width: `${(poolTimeLeft / 60) * 100}%` }}
                  />
                )}
              </button>
              
              <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-3 text-center">
                <div className="space-y-0.5">
                  <p className="text-[8px] text-gray-500 font-mono uppercase tracking-tighter">Step A</p>
                  <p className="text-[9px] text-emerald-400 font-bold uppercase">Intuition</p>
                </div>
                <div className="space-y-0.5 border-x border-white/5">
                  <p className="text-[8px] text-gray-500 font-mono uppercase tracking-tighter">Step B</p>
                  <p className="text-[9px] text-emerald-400 font-bold uppercase">Consensus</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[8px] text-gray-500 font-mono uppercase tracking-tighter">Step C</p>
                  <p className="text-[9px] text-emerald-400 font-bold uppercase">The Bridge</p>
                </div>
              </div>
            </div>
          </section>

          {/* Column 4: Signal Intel (Intelligence Sidebar) */}
          <section className="glass p-6 rounded-2xl flex flex-col space-y-5 neon-border overflow-hidden bg-black/20">
            <h2 className="text-lg font-bold text-white flex items-center gap-3 flex-none">
              <Zap className="w-4 h-4 text-emerald-500" />
              Signal Intel
            </h2>

            {!showResults ? (
              <div className="flex-1 min-h-0 flex flex-col space-y-5 overflow-hidden">
                {/* Bot Logs Feed */}
                <div className="bg-black/60 rounded-xl border border-white/5 p-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between text-[8px] font-mono text-emerald-500/50 uppercase tracking-widest mb-3">
                    <span>Network Logs</span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                      Monitoring
                    </span>
                  </div>
                  <div className="flex-1 font-mono text-[10px] space-y-2 overflow-y-auto custom-scrollbar flex flex-col-reverse opacity-60">
                    {botLogs.length > 0 ? (
                      botLogs.map((log) => (
                        <div key={log.id} className="text-emerald-400/80">
                          <span className="text-emerald-500/30">[{log.timestamp.slice(11,19)}]</span>{' '}
                          <span className="text-emerald-300 font-bold">{log.tag}</span>{' '}
                          {log.message}
                        </div>
                      ))
                    ) : (
                      <div className="text-emerald-500/20 italic">Listening for network events...</div>
                    )}
                  </div>
                </div>

                <div className="text-center space-y-2 py-4 flex-none">
                  <div className="w-10 h-10 border border-emerald-500/20 rounded-full mx-auto flex items-center justify-center animate-spin-slow">
                    <Terminal className="w-4 h-4 opacity-20" />
                  </div>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-gray-500">Lock your guess to unlock reports</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 space-y-5 overflow-y-auto custom-scrollbar pr-2 animate-in fade-in zoom-in-95 duration-500">
                {/* User Results */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-mono text-gray-500 uppercase">You (Target)</span>
                    <User className="w-2.5 h-2.5 text-gray-500" />
                  </div>
                  <div className="text-xl font-mono text-white">${userPrediction.toLocaleString()}</div>
                </div>

                {/* Experts Comparison */}
                <div className="space-y-2">
                  <div className={cn(
                    "p-4 rounded-xl border transition-all relative overflow-hidden",
                    activePool ? "bg-emerald-500/5 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.05)]" : "bg-gray-500/5 border-white/10 opacity-60"
                  )}>
                    <div className="flex justify-between items-center mb-1 relative z-10">
                      <span className="text-[9px] font-mono text-emerald-400/70 uppercase">Mirror Consensus</span>
                      <Users className="w-2.5 h-2.5 text-emerald-400/70" />
                    </div>
                    <div className="text-xl font-mono text-emerald-400 relative z-10">
                      {activePool 
                        ? (isLoading ? '...' : mirrorPrediction ? `$${mirrorPrediction.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'N/A')
                        : 'OFFLINE'}
                    </div>
                  </div>

                  {activePool && topPredictors.length > 0 && !isLoading && (
                    <div className="px-2 space-y-2 border-l border-emerald-500/20 ml-2 animate-in fade-in slide-in-from-top-1 duration-500">
                      {/* Whale Entry Alert */}
                      {topPredictors.some(p => hallOfFame.find(w => w.username === p.username && w.isWhale)) && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-3 flex items-center gap-3 animate-pulse">
                          <Zap className="w-4 h-4 text-amber-500" />
                          <div className="text-[8px] font-bold text-amber-400 uppercase tracking-widest">
                            Whale Entry Detected: {topPredictors.filter(p => hallOfFame.find(w => w.username === p.username && w.isWhale)).map(p => p.username).join(', ')}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[7px] font-mono text-emerald-500/40 uppercase tracking-widest">Live Signals</p>
                        <p className="text-[7px] font-mono text-emerald-500/40 uppercase tracking-widest">P.Score</p>
                      </div>
                      {topPredictors.map((p, i) => {
                        const isGlobalWhale = hallOfFame.some(w => w.username === p.username && w.isWhale);
                        return (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono group">
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-500/30 text-[8px]">#{i+1}</span>
                              <span className={cn(
                                "transition-colors truncate max-w-[70px]",
                                isGlobalWhale ? "text-amber-400 font-bold" : "text-gray-400 group-hover:text-white"
                              )}>{p.username}</span>
                              {isGlobalWhale && (
                                <span className="text-[6px] bg-amber-500/20 text-amber-500 px-1 rounded font-bold">WHALE</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-emerald-500/60">${p.forecast.toLocaleString()}</span>
                              <button 
                                onClick={() => setUserPrediction(p.forecast)}
                                className="text-[7px] bg-emerald-500/10 hover:bg-emerald-500/30 text-emerald-400 px-1 rounded border border-emerald-500/20 transition-all opacity-0 group-hover:opacity-100"
                              >
                                MIRROR
                              </button>
                              <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded text-[8px] min-w-[24px] text-center">{p.score}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* AI Comparison */}
                <div className="p-4 rounded-xl bg-lime-500/5 border border-lime-500/20 relative overflow-hidden group">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-mono text-lime-400/70 uppercase flex items-center gap-2">
                      AI News Sentiment
                      {isLoading && <span className="w-1 h-1 rounded-full bg-lime-400 animate-ping" />}
                    </span>
                    <Cpu className="w-3 h-3 text-lime-400/70" />
                  </div>
                  <div className="text-xl font-mono text-lime-400">
                    {isLoading ? 'CALIBRATING...' : aiPrediction ? `$${aiPrediction.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'N/A'}
                  </div>

                  {/* AI Transparency: Headlines */}
                  {!isLoading && aiHeadlines.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-lime-500/10 space-y-1.5">
                      <p className="text-[7px] font-mono text-lime-400/40 uppercase tracking-widest">Sentiment Context (Mistral-7B)</p>
                      {aiHeadlines.map((h, i) => (
                        <div key={i} className="text-[8px] text-lime-200/50 leading-tight border-l border-lime-500/20 pl-2 hover:text-lime-200 transition-colors">
                          {h}
                        </div>
                      ))}
                    </div>
                  )}

                  {!activePool && !isLoading && aiPrediction && (
                    <div className="absolute top-1 right-1 opacity-20">
                       <div className="text-[6px] font-mono uppercase bg-lime-500/20 px-1 rounded">Warm-up Active</div>
                    </div>
                  )}
                </div>

                <div className="pt-2 space-y-3 pb-4">
                  <p className="text-[9px] font-mono text-gray-500 text-center uppercase tracking-tighter">
                    3. Compare, Refine, and Conquer
                  </p>
                  {activePool ? (
                    <a 
                      href={`https://trepa.io/pools/${activePool.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded font-bold border border-white/20 text-xs transition-all duration-300 group"
                    >
                      PLACE REAL PREDICTION ON TREPA
                      <Zap className="w-3 h-3 text-emerald-400 group-hover:animate-pulse" />
                    </a>
                  ) : (                    <button 
                      disabled
                      className="w-full py-3 bg-white/5 text-gray-600 rounded font-bold border border-white/5 text-xs cursor-not-allowed"
                    >
                      MARKET CLOSED
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Educational Pixel Footer */}
      <footer className="flex-none w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 opacity-30 text-[8px] font-mono uppercase tracking-widest pt-4 border-t border-white/5">
        <div className="space-y-1">
          <p className="text-white font-black">Mirror Intelligence</p>
          <p>Weights Top 5 leaders from the official Trepa Leaderboard using historical Precision Scores.</p>
        </div>
        <div className="space-y-1">
          <p className="text-white font-black">AI Sentiment</p>
          <p>Real-time analysis of financial RSS feeds and Gemini Flash 1.5 market modeling.</p>
        </div>
        <div className="space-y-1">
          <p className="text-white font-black">The Bridge</p>
          <p>A high-conversion portal designed to train users before they commit capital on-chain.</p>
        </div>
        <div className="flex flex-col justify-end items-center md:items-end">
          <div className="flex gap-2 mb-1">
            <div className="w-1 h-1 bg-emerald-500" />
            <div className="w-1 h-1 bg-lime-500" />
            <div className="w-1 h-1 bg-teal-500" />
          </div>
          <span>SYS.TREPA.V1.2_BETA</span>
        </div>
      </footer>
    </div>
  );
}
