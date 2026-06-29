import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useChartStore } from '../../store/useChartStore';
import { useOrderStore } from '../../store/useOrderStore';
import socket from '../../socket';

function OIBar({ value, max }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
      <div className="h-full bg-accent/60 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Cell({ val, highlight, className = '' }) {
  const [flash, setFlash] = useState(null);
  const prev = useRef(val);
  useEffect(() => {
    if (prev.current !== val && val !== undefined) {
      setFlash(val > prev.current ? 'green' : 'red');
      const t = setTimeout(() => setFlash(null), 300);
      prev.current = val;
      return () => clearTimeout(t);
    }
    prev.current = val;
  }, [val]);
  return (
    <td className={`px-2 py-1 text-xs tabular-nums text-right transition-colors duration-75
      ${flash === 'green' ? 'animate-flash-green' : flash === 'red' ? 'animate-flash-red' : ''}
      ${highlight ? 'text-text-primary font-semibold' : 'text-text-secondary'} ${className}`}>
      {val !== undefined && val !== null ? (typeof val === 'number' ? val.toFixed(2) : val) : '—'}
    </td>
  );
}

function OICell({ val, max }) {
  return (
    <td className="px-2 py-1 text-xs">
      <div className="text-right tabular-nums text-text-secondary mb-0.5">
        {val ? (val >= 1e5 ? `${(val / 1e5).toFixed(1)}L` : val.toLocaleString()) : '—'}
      </div>
      <OIBar value={val || 0} max={max} />
    </td>
  );
}

function TradeCell({ val, onBuy, onSell }) {
  const [flash, setFlash] = useState(null);
  const prev = useRef(val);
  useEffect(() => {
    if (prev.current !== val && val !== undefined) {
      setFlash(val > prev.current ? 'green' : 'red');
      const t = setTimeout(() => setFlash(null), 300);
      prev.current = val;
      return () => clearTimeout(t);
    }
    prev.current = val;
  }, [val]);
  return (
    <td className={`group relative px-2 py-1 text-xs tabular-nums text-right font-semibold text-text-primary transition-colors duration-75 cursor-pointer
      ${flash === 'green' ? 'animate-flash-green' : flash === 'red' ? 'animate-flash-red' : ''}`}>
      {val !== undefined && val !== null ? val.toFixed(2) : '—'}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-0.5 bg-surface border border-border rounded p-0.5 shadow-dropdown transition-opacity z-20">
        <button onClick={e => { e.stopPropagation(); onBuy(); }}
          className="px-1.5 py-0.5 text-[10px] bg-up hover:bg-up/90 text-bg font-bold rounded active:scale-[0.95]">B</button>
        <button onClick={e => { e.stopPropagation(); onSell(); }}
          className="px-1.5 py-0.5 text-[10px] bg-down hover:bg-down/90 text-bg font-bold rounded active:scale-[0.95]">S</button>
      </div>
    </td>
  );
}

function GreekTooltip({ label, formula }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="cursor-help underline decoration-dotted">{label}</span>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-card border border-border rounded p-2 text-xs text-text-secondary w-48 shadow-dropdown z-50 whitespace-normal">
          {formula}
        </div>
      )}
    </span>
  );
}

export default function OptionChain() {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [fnoSet, setFnoSet] = useState(new Set());
  const symbol = useChartStore(s => s.symbol);
  const { openOrderPanel } = useOrderStore();

  const INDEX_CHAINS = ['NIFTY', 'BANKNIFTY', 'NIFTY MIDCAP SELECT'];

  useEffect(() => {
    fetch('/api/symbols').then(r => r.json()).then(d => setFnoSet(new Set(d.fno || []))).catch(() => {});
  }, []);

  // F&O stocks (RELIANCE, TCS, INFY, ...) get their own option chain now —
  // not just the 3 index chains. Anything with no listed F&O contracts
  // falls back to NIFTY, with a visible note explaining why.
  const isFnoEligible = INDEX_CHAINS.includes(symbol) || fnoSet.has(symbol);
  const chainSymbol = isFnoEligible ? symbol : 'NIFTY';
  const isStockChain = !INDEX_CHAINS.includes(chainSymbol);
  const chainData = useMarketStore(s => s.optionChains[chainSymbol]);

  useEffect(() => {
    socket.emit('subscribe', chainSymbol);
  }, [chainSymbol]);

  useEffect(() => {
    if (chainData?.expiryDates?.[0]) setSelectedExpiry(chainData.expiryDates[0]);
  }, [chainData?.expiryDates?.[0]]);

  if (!chainData) return (
    <div className="bg-surface h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border">
        <span className="text-xs font-semibold text-text-primary">Option Chain — {chainSymbol}</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-text-secondary text-xs text-center px-4">
          <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          Waiting for option chain data{isStockChain ? `\n(${chainSymbol} stock chains take a bit longer)` : ''}...
        </div>
      </div>
    </div>
  );

  const filteredChain = selectedExpiry
    ? chainData.chain.filter(r => r.expiry === selectedExpiry)
    : chainData.chain;

  const atm = filteredChain.reduce((closest, row) => {
    return Math.abs(row.strike - chainData.underlyingLTP) < Math.abs((closest?.strike || Infinity) - chainData.underlyingLTP)
      ? row : closest;
  }, null);

  const maxCEOI = Math.max(...filteredChain.map(r => r.CE?.oi || 0));
  const maxPEOI = Math.max(...filteredChain.map(r => r.PE?.oi || 0));

  const tradeOption = (side, optionType, strike, expiry) =>
    openOrderPanel(chainSymbol, side, { optionType, strike, expiry });

  return (
    <div className="bg-surface flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border">
        <div className="flex items-center gap-3">
          <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-1 text-xs font-semibold text-text-primary hover:text-accent transition-colors">
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Option Chain — {chainSymbol}{isStockChain ? ' (Stock)' : ''}
          </button>
          {!collapsed && (
            <>
              <span className="text-xs text-text-secondary">PCR: <span className="text-text-primary tabular-nums">{chainData.pcr}</span></span>
              <span className="text-xs text-text-secondary">Max Pain: <span className="text-warn tabular-nums">{chainData.maxPainStrike}</span></span>
              <span className="text-xs text-text-secondary">CE OI: <span className="text-down tabular-nums">{(chainData.totalCEOI / 1e5).toFixed(1)}L</span></span>
              <span className="text-xs text-text-secondary">PE OI: <span className="text-up tabular-nums">{(chainData.totalPEOI / 1e5).toFixed(1)}L</span></span>
            </>
          )}
        </div>
        {!collapsed && chainData.expiryDates?.length > 0 && (
          <select value={selectedExpiry || ''} onChange={e => setSelectedExpiry(e.target.value)}
            className="bg-card border border-border rounded px-2 py-0.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent">
            {chainData.expiryDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>

      {!collapsed && !isFnoEligible && (
        <div className="px-4 py-1 text-[11px] text-warn bg-warn/5 border-b border-border">
          {symbol} has no listed F&O contracts — showing NIFTY options instead. Pick an F&O stock (e.g. RELIANCE, TCS, INFY) to trade its own options.
        </div>
      )}

      {!collapsed && (
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="border-b border-border">
                <th colSpan={8} className="text-center py-1 text-down text-xs font-semibold border-r border-border">CALLS</th>
                <th className="text-center py-1 px-3 text-text-secondary font-semibold">STRIKE</th>
                <th colSpan={8} className="text-center py-1 text-up text-xs font-semibold border-l border-border">PUTS</th>
              </tr>
              <tr className="border-b border-border text-text-secondary">
                {['OI','OI Chg%','Vol','IV','Δ','LTP','Bid','Ask'].map(h => (
                  <th key={h} className="px-2 py-1 text-right font-medium">
                    {h === 'Δ' ? <GreekTooltip label="Δ" formula="Delta: rate of change of option price w.r.t. underlying" /> : h}
                  </th>
                ))}
                <th className="px-3 py-1 text-center font-semibold text-text-secondary">Strike</th>
                {['Bid','Ask','LTP','Δ','IV','Vol','OI Chg%','OI'].map(h => (
                  <th key={h} className="px-2 py-1 text-right font-medium">
                    {h === 'Δ' ? <GreekTooltip label="Δ" formula="Delta: negative for puts, 0 to -1" /> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredChain.map(row => {
                const isATM = atm?.strike === row.strike;
                const isITM_CE = row.strike < chainData.underlyingLTP;
                const isITM_PE = row.strike > chainData.underlyingLTP;
                return (
                  <tr key={row.strike}
                    className={`hover:bg-card/60 transition-colors ${isATM ? 'bg-warn/5' : isITM_CE ? 'bg-down/5' : ''}`}>
                    <OICell val={row.CE?.oi} max={maxCEOI} />
                    <Cell val={row.CE?.oiChange} highlight={false} />
                    <Cell val={row.CE?.volume ? `${(row.CE.volume / 1000).toFixed(0)}K` : null} />
                    <Cell val={row.CE?.iv} />
                    <Cell val={row.CE?.greeks?.delta} />
                    <TradeCell
                      val={row.CE?.ltp}
                      onBuy={() => tradeOption('BUY', 'CE', row.strike, row.expiry)}
                      onSell={() => tradeOption('SELL', 'CE', row.strike, row.expiry)}
                    />
                    <Cell val={row.CE?.bid} />
                    <Cell val={row.CE?.ask} />
                    {/* Strike */}
                    <td className={`px-3 py-1 text-center font-bold text-sm tabular-nums
                      ${isATM ? 'text-warn bg-warn/10' : 'text-text-primary'}`}>
                      {row.strike}
                    </td>
                    <Cell val={row.PE?.bid} />
                    <Cell val={row.PE?.ask} />
                    <TradeCell
                      val={row.PE?.ltp}
                      onBuy={() => tradeOption('BUY', 'PE', row.strike, row.expiry)}
                      onSell={() => tradeOption('SELL', 'PE', row.strike, row.expiry)}
                    />
                    <Cell val={row.PE?.greeks?.delta} />
                    <Cell val={row.PE?.iv} />
                    <Cell val={row.PE?.volume ? `${(row.PE.volume / 1000).toFixed(0)}K` : null} />
                    <Cell val={row.PE?.oiChange} />
                    <OICell val={row.PE?.oi} max={maxPEOI} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
