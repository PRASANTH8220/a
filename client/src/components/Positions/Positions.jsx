import React, { useEffect } from 'react';
import { Briefcase, X } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';
import { useMarketStore } from '../../store/useMarketStore';

function PnLCard({ account }) {
  const total = account.unrealizedPnL + account.realizedPnL;
  return (
    <div className="p-3 border-b border-border">
      <div className={`tabular-nums text-xl font-bold ${total >= 0 ? 'text-up' : 'text-down'}`}>
        {total >= 0 ? '+' : ''}₹{Math.abs(total).toFixed(2)}
      </div>
      <div className="text-xs text-text-secondary mt-0.5">Total P&L (Unrealized + Realized)</div>
      <div className="flex gap-3 mt-2">
        <div>
          <div className={`tabular-nums text-xs font-semibold ${account.unrealizedPnL >= 0 ? 'text-up' : 'text-down'}`}>
            {account.unrealizedPnL >= 0 ? '+' : ''}₹{account.unrealizedPnL?.toFixed(2)}
          </div>
          <div className="text-xs text-text-secondary">Unrealized</div>
        </div>
        <div>
          <div className={`tabular-nums text-xs font-semibold ${account.dayPnL >= 0 ? 'text-up' : 'text-down'}`}>
            {account.dayPnL >= 0 ? '+' : ''}₹{account.dayPnL?.toFixed(2)}
          </div>
          <div className="text-xs text-text-secondary">Day P&L</div>
        </div>
      </div>
    </div>
  );
}

function PositionRow({ pos }) {
  const tick = useMarketStore(s => s.ticks[pos.symbol]);
  const { closePosition, refreshPositions, refreshAccount } = useOrderStore();
  const ltp = tick?.ltp || pos.entryPrice;
  const pnl = (ltp - pos.entryPrice) * pos.qty * (pos.side === 'BUY' ? 1 : -1);

  const handleClose = async () => {
    await closePosition(pos._id);
  };

  return (
    <div className="px-3 py-2.5 border-b border-border/50 hover:bg-card/60 transition-colors">
      <div className="flex items-start justify-between mb-1">
        <div>
          <span className="text-xs font-semibold text-text-primary">{pos.symbol}</span>
          {pos.strike > 0 && (
            <span className="ml-1 text-xs text-text-secondary">{pos.strike}{pos.optionType}</span>
          )}
          <span className={`ml-2 text-xs px-1 rounded ${pos.side === 'BUY' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>
            {pos.side}
          </span>
        </div>
        <button onClick={handleClose}
          className="p-0.5 hover:bg-card rounded text-text-secondary hover:text-down transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex justify-between text-xs">
        <div className="text-text-secondary">
          {pos.qty} × <span className="tabular-nums text-text-primary">{pos.entryPrice?.toFixed(2)}</span>
        </div>
        <div className="text-right">
          <div className="tabular-nums text-text-secondary">LTP: {ltp?.toFixed(2)}</div>
          <div className={`tabular-nums font-semibold ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
            {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Positions() {
  const { positions, account, refreshPositions, refreshAccount } = useOrderStore();

  useEffect(() => {
    refreshPositions();
    refreshAccount();
    const t = setInterval(() => { refreshPositions(); refreshAccount(); }, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <PnLCard account={account} />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {positions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-secondary">
            <Briefcase className="w-7 h-7 opacity-30" />
            <span className="text-xs">No open positions</span>
          </div>
        ) : positions.map(pos => <PositionRow key={pos._id} pos={pos} />)}
      </div>
    </div>
  );
}
