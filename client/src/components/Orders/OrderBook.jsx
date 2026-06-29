import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';

function OrderRow({ trade }) {
  const isClosed = trade.status === 'CLOSED';
  return (
    <div className="px-3 py-2 border-b border-border/50 hover:bg-card/60 transition-colors">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary">{trade.symbol}</span>
          <span className={`text-xs px-1 rounded ${trade.side === 'BUY' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>{trade.side}</span>
          <span className="text-xs text-text-secondary">{trade.orderType}</span>
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
          ${trade.status === 'OPEN' ? 'bg-accent/10 text-accent'
            : trade.status === 'CLOSED' ? 'bg-up/10 text-up'
            : 'bg-warn/10 text-warn'}`}>
          {trade.status}
        </span>
      </div>
      <div className="flex justify-between text-xs text-text-secondary">
        <span className="tabular-nums">{trade.qty} × ₹{trade.entryPrice?.toFixed(2)}</span>
        {isClosed && (
          <span className={`tabular-nums font-semibold ${trade.pnl >= 0 ? 'text-up' : 'text-down'}`}>
            {trade.pnl >= 0 ? '+' : ''}₹{trade.pnl?.toFixed(2)}
          </span>
        )}
        <span>{new Date(trade.entryTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

export default function OrderBook() {
  const { tradeHistory, pendingOrders } = useOrderStore();
  const [tab, setTab] = useState('pending');

  useEffect(() => {
    const load = async () => {
      const [hist, pending] = await Promise.all([
        fetch('/api/paper/trades').then(r => r.json()),
        fetch('/api/paper/orders').then(r => r.json()),
      ]);
      useOrderStore.getState().setTradeHistory(hist);
      useOrderStore.getState().setPendingOrders(pending);
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const rows = tab === 'pending' ? pendingOrders : tradeHistory;

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border">
        {['pending', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs transition-colors capitalize
              ${tab === t ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'}`}>
            {t === 'pending' ? 'Pending' : 'History'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-secondary">
            <ClipboardList className="w-7 h-7 opacity-30" />
            <span className="text-xs">No {tab === 'pending' ? 'pending orders' : 'trade history'}</span>
          </div>
        ) : rows.map(t => <OrderRow key={t._id} trade={t} />)}
      </div>
    </div>
  );
}
