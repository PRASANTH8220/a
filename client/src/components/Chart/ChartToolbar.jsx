import React from 'react';
import { ChevronUp, ChevronDown, Maximize2, Camera } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';

function fmt(n, d = 2) {
  if (n === null || n === undefined) return '—';
  return parseFloat(n).toFixed(d);
}

function fmtVol(v) {
  if (!v) return '—';
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v;
}

export default function ChartToolbar({ symbol, ohlcv, tick }) {
  const { openOrderPanel } = useOrderStore();
  const ltp = tick?.ltp;
  const change = ltp && tick?.open ? ltp - tick.open : 0;
  const changePct = tick?.open > 0 ? (change / tick.open * 100) : 0;
  const isUp = change >= 0;

  const display = ohlcv || (tick ? {
    open: tick.open, high: tick.high, low: tick.low, close: tick.ltp, volume: tick.volume
  } : null);

  return (
    <div className="flex items-center gap-4 px-3 py-2 bg-surface border-b border-border flex-shrink-0 flex-wrap">
      {/* Symbol + LTP */}
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm text-text-primary">{symbol}</span>
        {ltp ? (
          <>
            <span className={`tabular-nums text-lg font-bold ${isUp ? 'text-up' : 'text-down'}`}>
              {ltp.toFixed(2)}
            </span>
            <span className={`flex items-center gap-0.5 tabular-nums text-xs ${isUp ? 'text-up' : 'text-down'}`}>
              {isUp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {change.toFixed(2)} ({changePct.toFixed(2)}%)
            </span>
          </>
        ) : (
          <div className="w-24 h-5 bg-card rounded animate-pulse" />
        )}
      </div>

      {/* OHLCV from crosshair */}
      {display && (
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span><span className="text-text-secondary">O</span> <span className="text-text-primary">{fmt(display.open)}</span></span>
          <span><span className="text-up">H</span> <span className="text-text-primary">{fmt(display.high)}</span></span>
          <span><span className="text-down">L</span> <span className="text-text-primary">{fmt(display.low)}</span></span>
          <span><span className="text-text-secondary">C</span> <span className="text-text-primary">{fmt(display.close)}</span></span>
          <span><span className="text-text-secondary">V</span> <span className="text-text-primary">{fmtVol(display.volume)}</span></span>
        </div>
      )}

      <div className="flex-1" />

      {/* Buy/Sell buttons */}
      <div className="flex gap-2">
        <button onClick={() => openOrderPanel(symbol, 'BUY')}
          className="px-4 py-1.5 bg-up hover:bg-up/90 text-bg text-xs font-bold rounded-md transition-colors active:scale-[0.97]">
          BUY
        </button>
        <button onClick={() => openOrderPanel(symbol, 'SELL')}
          className="px-4 py-1.5 bg-down hover:bg-down/90 text-bg text-xs font-bold rounded-md transition-colors active:scale-[0.97]">
          SELL
        </button>
      </div>

      {/* Tools */}
      <div className="flex items-center gap-1">
        <button className="p-1.5 rounded hover:bg-card text-text-secondary hover:text-text-primary transition-colors" title="Fullscreen">
          <Maximize2 className="w-4 h-4" />
        </button>
        <button className="p-1.5 rounded hover:bg-card text-text-secondary hover:text-text-primary transition-colors" title="Screenshot">
          <Camera className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
