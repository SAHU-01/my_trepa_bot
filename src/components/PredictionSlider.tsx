'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Minus } from 'lucide-react';

interface PredictionSliderProps {
  min: number;
  max: number;
  step: number;
  currentPrice: number;
  initialValue: number;
  onChange: (value: number) => void;
}

export default function PredictionSlider({
  min,
  max,
  step,
  currentPrice,
  initialValue,
  onChange
}: PredictionSliderProps) {
  const [value, setValue] = useState(initialValue);
  const [inputValue, setInputValue] = useState(initialValue.toString());
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setValue(initialValue);
      setInputValue(initialValue.toLocaleString(undefined, { useGrouping: false }));
    }
  }, [initialValue, isEditing]);

  const updateValue = (newValue: number) => {
    const clampedValue = Math.max(min, Math.min(max, newValue));
    setValue(clampedValue);
    setInputValue(clampedValue.toString());
    onChange(clampedValue);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    updateValue(newValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    const newValue = parseFloat(e.target.value);
    if (!isNaN(newValue)) {
      const clampedValue = Math.max(min, Math.min(max, newValue));
      setValue(clampedValue);
      onChange(clampedValue);
    }
  };

  const handleInputBlur = () => {
    setIsEditing(false);
    const newValue = parseFloat(inputValue);
    if (isNaN(newValue)) {
      setInputValue(value.toString());
    } else {
      updateValue(newValue);
    }
  };

  const increment = () => updateValue(value + step);
  const decrement = () => updateValue(value - step);

  // Generate SVG path for a distribution curve centered around the current value
  const curvePath = useMemo(() => {
    const width = 1000;
    const height = 100;
    const centerX = ((value - min) / (max - min)) * width;
    
    // Simple bell curve (Gaussian-ish)
    const points = [];
    for (let x = 0; x <= width; x += 10) {
      const distance = Math.abs(x - centerX);
      const y = height - (Math.exp(-Math.pow(distance / 80, 2)) * height * 0.8);
      points.push(`${x},${y}`);
    }
    
    return `M 0,${height} ` + points.join(' ') + ` L ${width},${height}`;
  }, [value, min, max]);

  const isLong = value >= currentPrice;
  const percentDiff = ((value - currentPrice) / currentPrice) * 100;

  return (
    <div className="w-full space-y-6">
      <div className="relative h-40 w-full overflow-hidden rounded-lg bg-black/40 neon-border">
        {/* Background Grid */}
        <div className="absolute inset-0 opacity-10" 
             style={{ backgroundImage: 'linear-gradient(#39ff14 1px, transparent 1px), linear-gradient(90deg, #39ff14 1px, transparent 1px)', backgroundSize: '20px 20px' }} 
        />

        {/* The Distribution Curve */}
        <svg
          viewBox="0 0 1000 100"
          className="absolute inset-0 w-full h-full preserve-3d"
          preserveAspectRatio="none"
        >
          <path
            d={curvePath}
            fill="none"
            stroke="url(#gradient)"
            strokeWidth="3"
            className="transition-all duration-150 ease-out"
          />
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={isLong ? "#39ff14" : "#ff3131"} stopOpacity="0.2" />
              <stop offset="50%" stopColor={isLong ? "#00ff96" : "#ff5f5f"} stopOpacity="1" />
              <stop offset="100%" stopColor={isLong ? "#39ff14" : "#ff3131"} stopOpacity="0.2" />
            </linearGradient>
          </defs>
        </svg>
        
        {/* Current Spot Price Marker */}
        <div 
          className="absolute top-0 bottom-0 w-px border-l border-dashed border-gray-500/50 z-10"
          style={{ left: `${((currentPrice - min) / (max - min)) * 100}%` }}
        >
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gray-800 text-[8px] font-mono text-gray-400 uppercase">
            Spot: ${currentPrice.toLocaleString()}
          </div>
        </div>

        {/* Current Prediction Value Marker */}
        <div 
          className="absolute top-0 bottom-0 w-px bg-white/50 shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-150 ease-out z-20"
          style={{ left: `${((value - min) / (max - min)) * 100}%` }}
        >
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 glass text-xs font-bold neon-text whitespace-nowrap border border-white/20">
            ${value.toLocaleString()}
            <span className={`ml-2 text-[10px] ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
              ({percentDiff > 0 ? '+' : ''}{percentDiff.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Long/Short Indicators */}
        <div className="absolute bottom-4 left-4 text-[10px] font-bold font-mono opacity-50 flex items-center gap-2">
           <div className={`w-2 h-2 rounded-full ${!isLong ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`} />
           SHORT
        </div>
        <div className="absolute bottom-4 right-4 text-[10px] font-bold font-mono opacity-50 flex items-center gap-2">
           LONG
           <div className={`w-2 h-2 rounded-full ${isLong ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
        </div>
      </div>

      <div className="px-2 space-y-4">
        {/* Manual Input and Controls */}
        <div className="flex items-center justify-center gap-4">
          <button 
            onClick={decrement}
            className="p-2 rounded-lg bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/60 transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
          
          <div className="relative group">
            <div className="absolute -inset-1 bg-emerald-500/20 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative flex items-center bg-black border border-emerald-500/50 rounded-lg px-4 py-2">
              <span className="text-emerald-500/50 font-mono mr-2">$</span>
              <input
                ref={inputRef}
                type="text"
                value={isEditing ? inputValue : value.toLocaleString()}
                onChange={handleInputChange}
                onFocus={() => setIsEditing(true)}
                onBlur={handleInputBlur}
                className="bg-transparent border-none outline-none text-white font-mono text-xl w-32 text-center focus:ring-0"
              />
            </div>
          </div>

          <button 
            onClick={increment}
            className="p-2 rounded-lg bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/60 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="relative pt-6">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleSliderChange}
            className="w-full h-2 rounded-lg cursor-pointer appearance-none bg-emerald-900/30 accent-emerald-500"
          />
          
          {/* Precision Label */}
          <div 
            className="absolute -top-1 font-mono text-[9px] text-emerald-500 uppercase tracking-tighter transition-all duration-150"
            style={{ 
              left: `${((value - min) / (max - min)) * 100}%`,
              transform: 'translateX(-50%)'
            }}
          >
            PRECISION TARGET
          </div>
        </div>

        <div className="flex justify-between text-[10px] text-emerald-400/60 font-mono">
          <span>${min.toLocaleString()}</span>
          <span>${max.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
