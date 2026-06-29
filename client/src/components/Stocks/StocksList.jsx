import React, { useState, useEffect, useMemo } from 'react';
import { Building2, TrendingUp, TrendingDown } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useChartStore } from '../../store/useChartStore';
import { useOrderStore } from '../../store/useOrderStore';
import socket from '../../socket';

const MAX_RENDERED = 60; // cap rendered/subscribed rows so we don't open 500 socket rooms at once

function StockRow({ symbol, isFno }) {
  const tick = useMarketStore(s => s.ticks[symbol]);
  const updateTick = useMarketStore(s => s.updateTick);
  const { setSymbol } = useChartStore();
  const { openOrderPanel } = useOrderStore();

  useEffect(() => {
    socket.emit('subscribe', symbol);

    // If no live tick shows up shortly (market closed / pre-open / this
    // symbol just isn't in the live-rotation yet), fall back to a one-off
    // REST snapshot. The server itself falls back NSE-snapshot -> last
    // close, so this keeps working even when the market is shut.
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      const current = useMarketStore.getState().ticks[symbol];
      if (current?.ltp) return;
      try {
        const r = await fetch(`/api/quote/${symbol}`);
        if (r.ok) {
          const data = await r.json();
          if (!cancelled && data?.ltp) updateTick(symbol, data);
        }
      } catch {}
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(t);
      socket.emit('unsubscribe', symbol);
    };
  }, [symbol]);

  const changePct = tick?.open > 0 ? ((tick.ltp - tick.open) / tick.open * 100).toFixed(2) : null;
  const isUp = changePct !== null && parseFloat(changePct) >= 0;
  const isStale = tick?.source && tick.source !== 'live';

  return (
    <div
      className="group relative flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50 hover:bg-card/60 transition-colors duration-100 hover:-translate-y-px"
      onClick={() => setSymbol(symbol)}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-text-primary truncate flex items-center gap-1.5">
          {symbol}
          {isFno && (
            <span className="px-1 py-0 rounded text-[9px] font-bold bg-purple-500/20 text-purple-400 leading-tight">F&O</span>
          )}
        </div>
        {changePct !== null ? (
          <div className={`text-xs tabular-nums flex items-center gap-0.5 ${isUp ? 'text-up' : 'text-down'}`}>
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(changePct)}%
          </div>
        ) : (
          <div className="text-xs text-text-secondary">—</div>
        )}
      </div>

      <div className="text-right min-w-[64px]">
        {tick?.ltp ? (
          <>
            <div className={`tabular-nums text-sm font-semibold ${isUp ? 'text-up' : 'text-down'}`}>
              {tick.ltp.toFixed(2)}
            </div>
            {isStale && <div className="text-[9px] text-text-secondary leading-tight">last close</div>}
          </>
        ) : (
          <div className="w-14 h-4 bg-card rounded animate-pulse ml-auto" />
        )}
      </div>

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

export default function StocksList() {
  const [nifty500, setNifty500] = useState([]);
  const [fnoSet, setFnoSet] = useState(new Set());
  const [search, setSearch] = useState('');
  const [fnoOnly, setFnoOnly] = useState(false);

  useEffect(() => {
    fetch('/api/symbols').then(r => r.json()).then(d => {
      setNifty500(d.nifty500 || []);
      setFnoSet(new Set(d.fno || []));
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let list = nifty500;
    if (fnoOnly) list = list.filter(s => fnoSet.has(s));
    if (search) list = list.filter(s => s.includes(search.toUpperCase()));
    return list.slice(0, MAX_RENDERED);
  }, [nifty500, fnoSet, fnoOnly, search]);

  const totalForFilter = fnoOnly ? [...fnoSet].filter(s => nifty500.includes(s)).length : nifty500.length;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <Building2 className="w-3.5 h-3.5" /> Stocks — Nifty 500
        </div>
        <input
          type="text"
          placeholder="Search Nifty 500..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-card border border-border rounded-md px-2 py-1.5 text-xs text-text-primary placeholder-text-secondary outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-shadow"
        />
        <div className="flex rounded-md overflow-hidden border border-border text-xs">
          <button
            onClick={() => setFnoOnly(false)}
            className={`flex-1 py-1 font-medium transition-colors ${!fnoOnly ? 'bg-accent/10 text-accent' : 'bg-card text-text-secondary hover:text-text-primary'}`}
          >All 500</button>
          <button
            onClick={() => setFnoOnly(true)}
            className={`flex-1 py-1 font-medium transition-colors ${fnoOnly ? 'bg-accent/10 text-accent' : 'bg-card text-text-secondary hover:text-text-primary'}`}
          >F&O Only</button>
        </div>
        <p className="text-[10px] text-text-secondary">
          Showing {filtered.length} of {totalForFilter}{search ? ' matching' : ''}{filtered.length >= MAX_RENDERED ? ' — refine search for more' : ''}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-secondary">
            <Building2 className="w-8 h-8 opacity-30" />
            <span className="text-xs">No matches</span>
          </div>
        ) : (
          filtered.map(sym => <StockRow key={sym} symbol={sym} isFno={fnoSet.has(sym)} />)
        )}
      </div>
    </div>
  );
}
