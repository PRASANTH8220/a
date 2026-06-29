import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, TrendingUp, TrendingDown } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useChartStore } from '../../store/useChartStore';
import { useOrderStore } from '../../store/useOrderStore';
import socket from '../../socket';

function Sparkline({ data = [] }) {
  if (data.length < 2) return <div className="w-16 h-6" />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const w = 64, h = 24;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const isUp = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={isUp ? '#0ECB81' : '#F6465D'} strokeWidth="1.5" />
    </svg>
  );
}

function WatchRow({ symbol, onRemove }) {
  const tick = useMarketStore(s => s.ticks[symbol]);
  const { setSymbol } = useChartStore();
  const { openOrderPanel } = useOrderStore();
  const [flash, setFlash] = useState(null);
  const prevLtp = useRef(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!tick?.ltp) return;
    if (prevLtp.current !== null && prevLtp.current !== tick.ltp) {
      setFlash(tick.ltp > prevLtp.current ? 'green' : 'red');
      setTimeout(() => setFlash(null), 300);
    }
    prevLtp.current = tick.ltp;
    setHistory(h => [...h.slice(-19), tick.ltp]);
  }, [tick?.ltp]);

  const changePct = tick?.open && tick?.open > 0
    ? ((tick.ltp - tick.open) / tick.open * 100).toFixed(2)
    : '0.00';
  const isUp = parseFloat(changePct) >= 0;

  return (
    <div
      className={`group relative flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50
        hover:bg-card/60 transition-colors duration-100 hover:-translate-y-px
        ${flash === 'green' ? 'animate-flash-green' : flash === 'red' ? 'animate-flash-red' : ''}`}
      onClick={() => setSymbol(symbol)}
    >
      {/* Remove btn */}
      <button
        className="absolute left-1 top-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface transition-opacity"
        onClick={e => { e.stopPropagation(); onRemove(symbol); }}
      >
        <X className="w-3 h-3 text-text-secondary" />
      </button>

      {/* Symbol */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-text-primary truncate">{symbol}</div>
        <div className={`text-xs tabular-nums flex items-center gap-0.5 ${isUp ? 'text-up' : 'text-down'}`}>
          {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(changePct)}%
        </div>
      </div>

      {/* Sparkline */}
      <Sparkline data={history} />

      {/* LTP */}
      <div className="text-right min-w-[60px]">
        {tick ? (
          <div className={`tabular-nums text-sm font-semibold ${isUp ? 'text-up' : 'text-down'}`}>
            {tick.ltp?.toFixed(2)}
          </div>
        ) : (
          <div className="w-14 h-4 bg-card rounded animate-pulse" />
        )}
      </div>

      {/* Buy/Sell on hover */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity bg-surface rounded p-0.5">
        <button
          onClick={e => { e.stopPropagation(); openOrderPanel(symbol, 'BUY'); }}
          className="px-2 py-0.5 text-xs bg-up hover:bg-up/90 text-bg font-semibold rounded transition-colors active:scale-[0.97]"
        >B</button>
        <button
          onClick={e => { e.stopPropagation(); openOrderPanel(symbol, 'SELL'); }}
          className="px-2 py-0.5 text-xs bg-down hover:bg-down/90 text-bg font-semibold rounded transition-colors active:scale-[0.97]"
        >S</button>
      </div>
    </div>
  );
}

export default function MarketWatch() {
  const { watchlist, addToWatchlist, removeFromWatchlist } = useMarketStore();
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [allSymbols, setAllSymbols] = useState([]);

  useEffect(() => {
    fetch('/api/symbols').then(r => r.json()).then(d =>
      setAllSymbols([...new Set([...d.nifty500, ...d.fno, ...d.indices])])
    ).catch(() => {});
  }, []);

  useEffect(() => {
    watchlist.forEach(s => socket.emit('subscribe', s));
  }, [watchlist]);

  const handleSearch = (q) => {
    setSearch(q);
    if (!q) { setSuggestions([]); return; }
    setSuggestions(allSymbols.filter(s => s.includes(q.toUpperCase())).slice(0, 5));
  };

  const addSymbol = (sym) => {
    addToWatchlist(sym);
    socket.emit('subscribe', sym);
    setSearch('');
    setSuggestions([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="p-2 border-b border-border relative">
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="Add symbol..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="flex-1 bg-card border border-border rounded-md px-2 py-1.5 text-xs text-text-primary placeholder-text-secondary outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-shadow"
          />
          <button
            onClick={() => search && addSymbol(search.toUpperCase())}
            className="p-1.5 bg-accent hover:bg-accent/90 rounded-md transition-colors active:scale-[0.97]"
          >
            <Plus className="w-4 h-4 text-white" />
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="absolute left-2 right-2 top-full mt-1 bg-card border border-border rounded-lg shadow-dropdown z-20 animate-slide-down">
            {suggestions.map(s => (
              <button key={s} onClick={() => addSymbol(s)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-surface transition-colors text-text-primary">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-secondary">
            <Eye className="w-8 h-8 opacity-30" />
            <span className="text-xs">No symbols in watchlist</span>
            <span className="text-xs opacity-60">Search above to add</span>
          </div>
        ) : (
          watchlist.map(sym => (
            <WatchRow key={sym} symbol={sym} onRemove={removeFromWatchlist} />
          ))
        )}
      </div>
    </div>
  );
}
