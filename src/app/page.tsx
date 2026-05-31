'use client';

import React, { useState, useEffect } from 'react';
import PredictionSlider from '@/components/PredictionSlider';
import { Cpu, Users, User, Zap, Terminal, LogOut, Settings, Bell, History } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function PredictionArena() {
  const { login, logout, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];

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

  // Follow & Mirror State
  const [following, setFollowing] = useState<string[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [isSyncingFollows, setIsSyncingFollows] = useState(false);

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
    const interval = setInterval(fetchHallOfFame, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch User's Follows and Activity via server-side API (bypasses RLS)
  useEffect(() => {
    const userAddress = wallets[0]?.address;
    if (!authenticated || !userAddress) return;

    const fetchSupabaseData = async () => {
      setIsSyncingFollows(true);
      try {
        const res = await fetch(`/api/user/follows?address=${encodeURIComponent(userAddress)}`);
        const data = await res.json();
        setFollowing(data.follows ?? []);
        setRecentActivity(data.activity ?? []);
      } catch (e) {}
      setIsSyncingFollows(false);
    };

    fetchSupabaseData();
  }, [authenticated, wallets]);

  const toggleFollow = async (whaleUsername: string) => {
    if (!authenticated) {
      login();
      return;
    }

    const userAddress = wallets[0]?.address;
    if (!userAddress) return;

    // Optimistic update
    const isFollowing = following.includes(whaleUsername);
    setFollowing(prev =>
      isFollowing ? prev.filter(w => w !== whaleUsername) : [...prev, whaleUsername]
    );

    try {
      const res = await fetch('/api/user/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: userAddress, whale: whaleUsername }),
      });
      const data = await res.json();
      // Reconcile with server truth
      setFollowing(prev =>
        data.following
          ? prev.includes(whaleUsername) ? prev : [...prev, whaleUsername]
          : prev.filter(w => w !== whaleUsername)
      );
    } catch (e) {
      console.error('Failed to toggle follow:', e);
      // Revert optimistic update on failure
      setFollowing(prev =>
        isFollowing ? [...prev, whaleUsername] : prev.filter(w => w !== whaleUsername)
      );
    }
  };

  // Fetch data and handle pool transitions
  useEffect(() => {
    const fetchData = async () => {
      try {
        const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const priceData = await priceRes.json();
        const price = parseFloat(priceData.price);
        setCurrentPrice(price);

        const poolRes = await fetch('/api/pools/active');
        const data = await poolRes.json();
        
        // Transition logic: Trigger result modal if pool ends or changes
        if (activePool && (!data.pool || data.pool.id !== activePool.id)) {
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

        // Dynamic Range Adjustment (ensure spot is always visible)
        const buffer = price * 0.1; // 10% buffer
        const newMin = Math.floor(price - buffer);
        const newMax = Math.ceil(price + buffer);
        setRange(prev => {
          if (price < prev.min + (buffer/2) || price > prev.max - (buffer/2)) {
            return { min: newMin, max: newMax };
          }
          return prev;
        });
        // Snap user prediction to spot price if it falls outside the visible range
        setUserPrediction(prev => {
          if (prev < newMin || prev > newMax) return Math.round(price);
          return prev;
        });

        setActivePool(data.pool || null);
        setExpertCount(data.expertCount || 0);
        setNextSessionAt(data.nextSessionAt || null);

        if (data.pool?.prediction_end_date) {
          const endTime = new Date(data.pool.prediction_end_date).getTime();
          const timeLeft = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
          setPoolTimeLeft(timeLeft);
        }
      } catch (e) {}
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [activePool, userPrediction, mirrorPrediction, topPredictors]);

  // Rest of effects...
  useEffect(() => {
    if (poolTimeLeft === null || poolTimeLeft <= 0) return;
    const timer = setInterval(() => setPoolTimeLeft(p => (p && p > 0) ? p - 1 : 0), 1000);
    return () => clearInterval(timer);
  }, [poolTimeLeft]);

  useEffect(() => {
    if (!nextSessionAt) return;
    const update = () => {
      const diff = new Date(nextSessionAt).getTime() - Date.now();
      if (diff <= 0) { setCountdown("LIVE SOON"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${h}H : ${m}M : ${s}S`);
    };
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [nextSessionAt]);

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
    setIsSubmitting(true);
    await new Promise(r => setTimeout(r, 1500));
    setIsSubmitting(false);
    setIsLoading(true);
    setShowResults(true);
    
    try {
      const aiRes = await fetch(`/api/forecast/ai?symbol=BTC&currentPrice=${userPrediction}`);
      const aiData = await aiRes.json();
      setAiPrediction(aiData.prediction);
      setAiHeadlines(aiData.headlines || []);

      if (activePool) {
        const mirrorRes = await fetch(`/api/forecast/mirror?poolId=${activePool.id}`);
        const mirrorData = await mirrorRes.json();
        setMirrorPrediction(mirrorData.prediction);
        setTopPredictors(mirrorData.topPredictors || []);
      }
    } catch (e) {} finally { setIsLoading(false); }
  };

  const handleMirrorLock = () => {
    if (mirrorPrediction) setUserPrediction(Math.round(mirrorPrediction));
  };

  return (
    <div className="min-h-screen md:h-screen p-4 md:p-6 flex flex-col space-y-4 bg-[#0a0a0a] md:overflow-hidden overflow-y-auto">
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

        <div className="flex flex-col md:flex-row items-center gap-4">
          {/* Privy Wallet Info */}
          <div className="flex items-center gap-3">
            {authenticated ? (
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-white font-mono font-bold">
                    {wallets[0]?.address.slice(0, 6)}...{wallets[0]?.address.slice(-4)}
                  </span>
                  <span className="text-[8px] text-emerald-500 font-mono uppercase">Connected</span>
                </div>
                <button 
                  onClick={logout}
                  className="p-2 rounded bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-all"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs transition-all flex items-center gap-2"
              >
                <Zap className="w-3 h-3" />
                CONNECT WALLET
              </button>
            )}
          </div>

          <div className="flex flex-col items-center md:items-end gap-1">
            <div className={cn(
              "px-4 py-1.5 rounded-full border flex items-center gap-3 font-mono text-[10px] transition-all relative overflow-hidden",
              activePool ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"
            )}>
              {activePool && poolTimeLeft !== null && (
                <div className="absolute left-0 top-0 bottom-0 bg-emerald-500/10 transition-all duration-1000 ease-linear" style={{ width: `${(poolTimeLeft / 60) * 100}%` }} />
              )}
              <span className={cn("w-1.5 h-1.5 rounded-full z-10", activePool ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
              <div className="flex items-center gap-2 z-10">
                {activePool ? (
                  <>
                    <span className={cn(poolTimeLeft !== null && poolTimeLeft < 15 ? "text-red-500 font-bold" : "")}>
                      {poolTimeLeft !== null ? `${poolTimeLeft}S UNTIL LOCK` : 'MARKET LIVE'}
                    </span>
                  </>
                ) : "WARM-UP MODE"}
                {!activePool && countdown && (
                  <span className="border-l border-white/10 pl-3 ml-1 font-bold text-white tracking-widest">{countdown}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 md:min-h-0 w-full max-w-[1600px] mx-auto md:overflow-hidden px-0 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-4 h-full pb-4">
          
          {/* Column 1: Whale Radar (Follow Engine) */}
          <section className="glass p-4 rounded-2xl flex flex-col space-y-4 neon-border md:overflow-hidden bg-black/20 min-h-[400px] md:min-h-0">
            <div className="flex items-center justify-between text-[10px] font-mono text-emerald-500 uppercase tracking-widest border-b border-white/5 pb-2">
              <span className="flex items-center gap-2">
                <Users className="w-3 h-3" />
                Whale Radar
              </span>
              <span className="text-[8px] opacity-50">Scanning History</span>
            </div>

            <div className="flex-1 md:overflow-y-auto custom-scrollbar space-y-3 pr-1">
              {hallOfFame.length > 0 ? (
                hallOfFame.map((whale, i) => (
                  <div key={i} className="group relative">
                    <button
                      onClick={() => setSelectedWhale(whale)}
                      className={cn(
                        "w-full text-left p-3 rounded-xl border transition-all relative overflow-hidden",
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
                    </button>
                    
                    {/* FOLLOW BUTTON OVERLAY */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFollow(whale.username); }}
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full border transition-all z-20",
                        following.includes(whale.username)
                          ? "bg-emerald-500 border-emerald-500 text-black scale-100"
                          : "bg-black/80 border-white/20 text-white opacity-0 group-hover:opacity-100 scale-90"
                      )}
                    >
                      <Bell className={cn("w-3 h-3", following.includes(whale.username) && "fill-current")} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 opacity-30">
                  <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto" />
                </div>
              )}
            </div>

            {selectedWhale && (
              <div className="flex-none p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30 animate-in slide-in-from-bottom-2 duration-300">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-[9px] font-mono text-emerald-400 uppercase font-bold tracking-tighter">Deep Intel: {selectedWhale.username}</p>
                  <button onClick={() => setSelectedWhale(null)} className="text-gray-500 hover:text-white">×</button>
                </div>
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-black/40 rounded border border-white/5">
                      <p className="text-[7px] text-gray-500 uppercase mb-0.5">Win Rate</p>
                      <p className="text-[11px] font-mono text-emerald-400 font-bold">{selectedWhale.winRate}%</p>
                    </div>
                    <div className="p-2 bg-black/40 rounded border border-white/5">
                      <p className="text-[7px] text-gray-500 uppercase mb-0.5">Total SOL</p>
                      <p className="text-[11px] font-mono text-emerald-400 font-bold">{selectedWhale.totalStaked.toFixed(1)}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => toggleFollow(selectedWhale.username)}
                    className={cn(
                      "w-full py-2 rounded text-[10px] font-bold transition-all uppercase",
                      following.includes(selectedWhale.username)
                        ? "bg-emerald-500/20 border border-emerald-500 text-emerald-400"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    )}
                  >
                    {following.includes(selectedWhale.username) ? 'FOLLOWING' : 'FOLLOW WHALE'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Column 2-3: Precision Hub */}
          <section className="lg:col-span-2 glass p-6 md:px-10 md:py-6 rounded-2xl flex flex-col justify-between neon-border relative md:overflow-hidden bg-black/40 min-h-[500px] md:min-h-0">
            {lastResult && !showResults && (
              <div className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center p-6 animate-in fade-in duration-500">
                <div className="max-w-md w-full glass p-8 rounded-2xl border border-emerald-500/30 text-center space-y-6">
                  <h3 className="text-2xl font-black text-white">{lastResult.poolTitle}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-[8px] font-mono text-gray-500 uppercase mb-1">Actual Price</p>
                      <p className="text-xl font-mono text-white">${lastResult.finalPrice.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                      <p className="text-[8px] font-mono text-emerald-400 uppercase mb-1">Mirror Bot</p>
                      <p className="text-xl font-mono text-emerald-400">${lastResult.mirrorPrediction?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                  </div>
                  <button onClick={() => setLastResult(null)} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold">READY FOR NEXT DRILL</button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-emerald-300 font-mono text-[9px] uppercase tracking-widest">
                {activePool ? `Pool: ${activePool.title} • SPOT: $${currentPrice.toLocaleString()}` : "Warm-Up Forecast Mode"}
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-white">1. Define Your Forecast</h2>
              <p className="text-gray-400 text-[11px] max-w-md leading-tight">
                Calibrate your precision target. Mirror Bot and Whales provide consensus signals on the right.
              </p>
            </div>

            <div className="py-8 md:py-2 flex-1 flex flex-col justify-center relative">
              <PredictionSlider min={range.min} max={range.max} step={1} currentPrice={currentPrice} initialValue={userPrediction} onChange={setUserPrediction} />
              
              {/* RESULTS OVERLAY */}
              {(isLoading || showResults) && (
                <div className="absolute inset-0 bg-black/95 z-40 rounded-xl flex flex-col p-6 space-y-6 animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-mono text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      Consensus Analysis
                    </h3>
                    <button onClick={() => setShowResults(false)} className="text-gray-500 hover:text-white">×</button>
                  </div>

                  {isLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                      <div className="w-12 h-12 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                      <p className="text-[10px] font-mono text-emerald-500 animate-pulse uppercase tracking-[0.2em]">Intercepting Signals...</p>
                    </div>
                  ) : (
                    <div className="flex-1 space-y-6 overflow-y-auto custom-scrollbar pr-2">
                      <div className="grid grid-cols-2 gap-4">
                        {/* AI SIGNAL */}
                        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                          <div className="flex items-center gap-2 text-[8px] font-mono text-emerald-400 uppercase">
                            <Cpu className="w-3 h-3" />
                            AI Forecast
                          </div>
                          <div>
                            <p className="text-2xl font-mono text-white">${aiPrediction?.toLocaleString()}</p>
                            <p className="text-[8px] text-emerald-500/60 font-mono mt-1">Mistral-7B Intelligence</p>
                          </div>
                          <div className="pt-2 border-t border-white/5 space-y-1">
                            {aiHeadlines.map((h, i) => (
                              <p key={i} className="text-[7px] text-gray-400 line-clamp-1 italic">"{h}"</p>
                            ))}
                          </div>
                        </div>

                        {/* MIRROR SIGNAL */}
                        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                          <div className="flex items-center gap-2 text-[8px] font-mono text-emerald-400 uppercase">
                            <Users className="w-3 h-3" />
                            Mirror Bot
                          </div>
                          <div>
                            <p className="text-2xl font-mono text-white">
                              {mirrorPrediction ? `$${mirrorPrediction.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'NO PEERS'}
                            </p>
                            <p className="text-[8px] text-emerald-500/60 font-mono mt-1">Weighted Expert Average</p>
                          </div>
                          <button 
                            onClick={handleMirrorLock}
                            className="w-full py-1.5 bg-emerald-500 text-black text-[9px] font-bold rounded hover:bg-emerald-400 transition-colors"
                          >
                            LOCK MIRROR
                          </button>
                        </div>
                      </div>

                      {/* TOP EXPERTS LIST */}
                      {topPredictors.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Mirroring Top Experts</p>
                          <div className="grid grid-cols-1 gap-1.5">
                            {topPredictors.map((p, i) => (
                              <div key={i} className="flex justify-between items-center p-2 rounded bg-white/5 border border-white/5 text-[9px] font-mono">
                                <span className="text-white">{p.username}</span>
                                <span className="text-emerald-500">${p.forecast.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <button
                onClick={handleFetchPredictions}
                disabled={isLoading || isSubmitting}
                className={cn(
                  "w-full py-4 rounded-lg font-bold text-lg transition-all transform hover:scale-[1.01] relative overflow-hidden",
                  activePool ? "bg-gradient-to-r from-emerald-600 to-lime-600 text-white" : "bg-white/5 border border-white/10 text-white"
                )}
              >
                {isSubmitting ? 'CALIBRATING...' : isLoading ? 'SYNCING...' : activePool ? 'SUBMIT TO ARENA' : 'START PRACTICE'}
              </button>
            </div>
          </section>

          {/* Column 4: Signal Intel & Activity History */}
          <section className="glass p-6 rounded-2xl flex flex-col space-y-5 neon-border md:overflow-hidden bg-black/20 min-h-[450px] md:min-h-0">
            <div className="flex items-center justify-between text-white flex-none">
              <h2 className="text-lg font-bold flex items-center gap-3">
                <Zap className="w-4 h-4 text-emerald-500" />
                Signal Intel
              </h2>
              {authenticated && (
                <button className="p-1.5 hover:bg-white/5 rounded transition-colors text-gray-500">
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col space-y-5 md:overflow-hidden">
              {/* Activity History Tabbed Section */}
              <div className="flex-1 bg-black/60 rounded-xl border border-white/5 flex flex-col md:overflow-hidden">
                <div className="flex items-center gap-4 px-4 pt-3 text-[8px] font-mono text-emerald-500/50 uppercase tracking-widest">
                  <span className="flex items-center gap-1.5 border-b border-emerald-500 pb-1 text-emerald-400">
                    <Bell className="w-2.5 h-2.5" />
                    Following ({following.length})
                  </span>
                  <span className="flex items-center gap-1.5 pb-1 opacity-50">
                    <History className="w-2.5 h-2.5" />
                    Activity
                  </span>
                </div>

                <div className="flex-1 p-4 md:overflow-y-auto custom-scrollbar space-y-3">
                  {authenticated ? (
                    recentActivity.length > 0 ? (
                      recentActivity.map((act, i) => (
                        <div key={i} className="p-2 rounded bg-white/5 border border-white/5 text-[9px] font-mono">
                          <div className="flex justify-between text-gray-400 mb-1">
                            <span>Mirrored @{act.whale_username}</span>
                            <span className="text-emerald-500">+{act.pnl || '0.0'} SOL</span>
                          </div>
                          <div className="flex justify-between text-white font-bold">
                            <span>${act.forecast_value.toLocaleString()}</span>
                            <span className="opacity-50 text-[8px]">{act.status}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      following.length > 0 ? (
                        <div className="text-center py-10 space-y-2 opacity-30">
                          <Bell className="w-6 h-6 mx-auto animate-pulse" />
                          <p className="text-[8px] uppercase">Awaiting Whale Movements...</p>
                        </div>
                      ) : (
                        <div className="text-center py-10 space-y-2 opacity-30">
                          <Users className="w-6 h-6 mx-auto" />
                          <p className="text-[8px] uppercase">Follow a whale to start mirroring</p>
                        </div>
                      )
                    )
                  ) : (
                    <div className="text-center py-10 space-y-4 opacity-50">
                      <p className="text-[9px] uppercase font-mono leading-tight px-4">Connect wallet to unlock automated whale mirroring</p>
                      <button onClick={login} className="px-4 py-1.5 bg-emerald-500/10 border border-emerald-500 text-emerald-400 text-[10px] rounded font-bold">AUTHORIZE ARENA</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Bot Logs / Network Intel */}
              <div className="h-32 flex-none bg-black/40 rounded-xl border border-white/5 p-3 font-mono text-[9px] space-y-1.5 overflow-hidden">
                <div className="text-[7px] text-emerald-500/40 uppercase tracking-widest mb-2 flex justify-between">
                  <span>Network Logs</span>
                  <span className="flex items-center gap-1"><span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"/> LIVE</span>
                </div>
                <div className="space-y-1 opacity-60">
                  {botLogs.slice(0, 3).map((log, i) => (
                    <div key={i} className="truncate">
                      <span className="text-emerald-500/30">[{log.timestamp.slice(11,16)}]</span> {log.message}
                    </div>
                  ))}
                </div>
              </div>

              {activePool && (
                <a 
                  href={`https://trepa.io/streaks/bitcoin`}
                  target="_blank"
                  className="flex items-center justify-center gap-2 w-full py-4 bg-white/10 hover:bg-white/20 text-white rounded font-bold border border-white/20 text-xs transition-all group"
                >
                  PLACE REAL PREDICTION
                  <Zap className="w-3 h-3 text-emerald-400 group-hover:animate-pulse" />
                </a>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="flex-none w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 opacity-30 text-[8px] font-mono uppercase tracking-widest pt-4 border-t border-white/5">
        <div className="space-y-1">
          <p className="text-white font-black">Mirror Intelligence</p>
          <p>Weights Top 5 leaders using historical Precision Scores.</p>
        </div>
        <div className="space-y-1">
          <p className="text-white font-black">AI Sentiment</p>
          <p>Real-time analysis via Gemini Flash 1.5 modeling.</p>
        </div>
        <div className="space-y-1">
          <p className="text-white font-black">Secure Mirroring</p>
          <p>Privacy-preserving wallet delegation via Privy & sharded keys.</p>
        </div>
        <div className="flex flex-col justify-end items-center md:items-end">
          <span>SYS.TREPA.V1.2_BETA</span>
        </div>
      </footer>
    </div>
  );
}
