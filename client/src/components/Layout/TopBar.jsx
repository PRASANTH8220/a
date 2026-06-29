import React, { useState, useEffect, useRef } from 'react';
import { Settings, TrendingUp, Zap, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useOrderStore } from '../../store/useOrderStore';
import { useChartStore } from '../../store/useChartStore';

function IndexPill({ label, symbol }) {
  const tick = useMarketStore(s => s.ticks[symbol]);
  const [flash, setFlash] = useState(null);
  const prevLtp = useRef(null);

  useEffect(() => {
    if (tick?.ltp && prevLtp.current !== null && prevLtp.current !== tick.ltp) {
      setFlash(tick.ltp > prevLtp.current ? 'green' : 'red');
      setTimeout(() => setFlash(null), 300);
    }
    prevLtp.current = tick?.ltp ?? null;
  }, [tick?.ltp]);

  if (!tick) return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-card rounded-md border border-border">
      <span className="text-text-secondary text-xs font-medium">{label}</span>
      <div className="w-16 h-3 bg-surface rounded animate-pulse" />
    </div>
  );

  const change = tick.ltp - (tick.open || tick.ltp);
  const changePct = tick.open ? ((change / tick.open) * 100).toFixed(2) : '0.00';
  const isUp = change >= 0;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 bg-card rounded-md border border-border transition-colors duration-75
        ${flash === 'green' ? 'animate-flash-green' : flash === 'red' ? 'animate-flash-red' : ''}`}
    >
      <span className="text-text-secondary text-xs font-medium">{label}</span>
      <span className={`tabular-nums text-sm font-semibold ${isUp ? 'text-up' : 'text-down'}`}>
        {tick.ltp?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`text-xs tabular-nums flex items-center gap-0.5 ${isUp ? 'text-up' : 'text-down'}`}>
        {isUp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {Math.abs(changePct)}%
      </span>
    </div>
  );
}

function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [allSymbols, setAllSymbols] = useState([]);
  const { addToWatchlist } = useMarketStore();
  const { setSymbol } = useChartStore();
  const ref = useRef(null);

  useEffect(() => {
    fetch('/api/symbols').then(r => r.json()).then(data => {
      setAllSymbols([...new Set([...data.nifty500, ...data.fno, ...data.indices])]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (q) => {
    setQuery(q);
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    const filtered = allSymbols.filter(s => s.toUpperCase().includes(q.toUpperCase())).slice(0, 8);
    setResults(filtered);
    setOpen(true);
  };

  const selectSymbol = (sym) => {
    setSymbol(sym);
    addToWatchlist(sym);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative w-72" ref={ref}>
      <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5 focus-within:ring-2 focus-within:ring-accent focus-within:border-accent transition-shadow">
        <Search className="w-4 h-4 text-text-secondary flex-shrink-0" />
        <input
          type="text"
          placeholder="Search symbol..."
          value={query}
          onChange={e => handleSearch(e.target.value)}
          className="bg-transparent text-text-primary text-sm outline-none placeholder-text-secondary w-full"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-dropdown z-50 animate-slide-down overflow-hidden">
          {results.map(sym => (
            <button
              key={sym}
              onClick={() => selectSymbol(sym)}
              className="w-full text-left px-4 py-2.5 text-sm text-text-primary hover:bg-surface transition-colors flex items-center justify-between group"
            >
              <span className="font-medium">{sym}</span>
              <span className="text-text-secondary text-xs opacity-0 group-hover:opacity-100 transition-opacity">Click to add</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountPill() {
  const { account } = useOrderStore();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const fmt = (n) => `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className="relative">
      <button
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-md hover:bg-surface transition-colors"
      >
        <Zap className="w-3.5 h-3.5 text-warn" />
        <span className="text-text-secondary text-xs">Available</span>
        <span className="tabular-nums text-sm font-semibold text-text-primary">
          {fmt(account.availableBalance)}
        </span>
      </button>

      {showBreakdown && (
        <div className="absolute top-full right-0 mt-1 bg-card border border-border rounded-lg shadow-dropdown z-50 p-3 w-64 animate-slide-down">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Paper Account</p>
          {[
            ['Total Capital', account.totalCapital, null],
            ['Used Margin', account.usedMargin, null],
            ['Available', account.availableBalance, null],
            ['Unrealized P&L', account.unrealizedPnL, account.unrealizedPnL],
            ['Realized P&L', account.realizedPnL, account.realizedPnL],
            ['Day P&L', account.dayPnL, account.dayPnL],
          ].map(([label, val, color]) => (
            <div key={label} className="flex justify-between items-center py-1 border-b border-border last:border-0">
              <span className="text-text-secondary text-xs">{label}</span>
              <span className={`tabular-nums text-sm font-medium ${color !== null ? (color >= 0 ? 'text-up' : 'text-down') : 'text-text-primary'}`}>
                {color !== null && color >= 0 ? '+' : ''}{fmt(val)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketStatusPill() {
  const { marketOpen } = useMarketStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Determine based on IST time
  const ist = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours(), m = ist.getMinutes();
  const isOpen = (h === 9 && m >= 15) || (h >= 10 && h < 15) || (h === 15 && m <= 30);

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${isOpen ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-up animate-pulse-glow' : 'bg-down'}`} />
      {isOpen ? 'OPEN' : 'CLOSED'}
    </div>
  );
}

export default function TopBar() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const istTime = time.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <div className="h-12 flex-shrink-0 bg-surface border-b border-border flex items-center justify-between px-4 gap-4 z-30">
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <TrendingUp className="w-5 h-5 text-accent" />
        <span className="text-accent font-bold text-lg tracking-tight">NexTrade</span>
      </div>

      {/* Search */}
      <SearchBar />

      {/* Index prices */}
      <div className="flex items-center gap-2 flex-1 justify-center">
        <IndexPill label="NIFTY" symbol="NIFTY" />
        <IndexPill label="BANKNIFTY" symbol="BANKNIFTY" />
        <IndexPill label="SENSEX" symbol="SENSEX" />
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <MarketStatusPill />
        <span className="tabular-nums text-xs text-text-secondary">{istTime} IST</span>
        <AccountPill />
        <button className="p-1.5 rounded-md hover:bg-card text-text-secondary hover:text-text-primary transition-colors">
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
