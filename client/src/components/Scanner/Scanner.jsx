import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useChartStore } from '../../store/useChartStore';

function ScanRow({ rank, symbol, ltp, changePct, volume }) {
  const { setSymbol } = useChartStore();
  const isUp = changePct >= 0;
  return (
    <div
      onClick={() => setSymbol(symbol)}
      className="flex items-center gap-2 px-3 py-2 border-b border-border/50 hover:bg-card/60 cursor-pointer transition-colors hover:-translate-y-px"
    >
      <span className="text-text-secondary text-xs w-4 tabular-nums">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-text-primary truncate">{symbol}</div>
        <div className="text-xs text-text-secondary tabular-nums">{volume}</div>
      </div>
      <div className="text-right">
        <div className="tabular-nums text-xs font-medium text-text-primary">{ltp?.toFixed(2)}</div>
        <div className={`tabular-nums text-xs font-semibold ${isUp ? 'text-up' : 'text-down'}`}>
          {isUp ? '+' : ''}{changePct?.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

export default function Scanner() {
  const [tab, setTab] = useState('gainers');
  const { scannerResults } = useMarketStore();

  const tabs = [
    { key: 'gainers', label: 'Gainers', Icon: TrendingUp },
    { key: 'losers', label: 'Losers', Icon: TrendingDown },
    { key: 'oi', label: 'OI', Icon: Activity },
  ];

  const rows = tab === 'gainers' ? scannerResults.topGainers
    : tab === 'losers' ? scannerResults.topLosers
    : scannerResults.oiBuildup;

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border flex-shrink-0">
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors
              ${tab === key ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'}`}>
            <Icon className="w-3 h-3" />{label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!rows?.length ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-secondary">
            <Activity className="w-6 h-6 opacity-30 mb-1" />
            <span className="text-xs">Waiting for market data...</span>
          </div>
        ) : rows.map(r => (
          <ScanRow key={r.symbol} rank={r.rank} symbol={r.symbol}
            ltp={r.ltp} changePct={r.changePct} volume={r.volume} />
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-border">
        <span className="text-xs text-text-secondary">Auto-refreshes every 60s</span>
      </div>
    </div>
  );
}
