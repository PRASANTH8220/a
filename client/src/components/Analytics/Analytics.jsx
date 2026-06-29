import React, { useEffect, useState } from 'react';
import { RotateCcw, TrendingUp, AlertTriangle } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';

function MiniLineChart({ data, valueKey = 'value', color = '#1E88E5', height = 100 }) {
  if (!data || data.length < 2) return <div style={{ height }} className="flex items-center justify-center text-text-secondary text-xs">No data</div>;
  const values = data.map(d => d[valueKey]);
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const w = 220, h = height - 10;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h + 10}`} preserveAspectRatio="none" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function MiniBarChart({ data, valueKey = 'pnl', height = 80 }) {
  if (!data || data.length < 1) return <div style={{ height }} className="flex items-center justify-center text-text-secondary text-xs">No data</div>;
  const values = data.map(d => d[valueKey]);
  const max = Math.max(...values.map(Math.abs)) || 1;
  const w = 220, h = height;
  const bw = Math.max(2, (w / values.length) - 2);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }}>
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#2A2E35" strokeWidth="0.5" />
      {values.map((v, i) => {
        const barH = (Math.abs(v) / max) * (h / 2 - 2);
        const x = (i / values.length) * w;
        const y = v >= 0 ? h / 2 - barH : h / 2;
        return <rect key={i} x={x + 1} y={y} width={bw} height={barH} fill={v >= 0 ? '#0ECB81' : '#F6465D'} opacity="0.8" />;
      })}
    </svg>
  );
}

// Inline recharts import — falls back to simple SVG if not available
let charts = null;
try { charts = { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine }; } catch {}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-surface rounded-lg p-3 border border-border">
      <div className="text-xs text-text-secondary mb-1">{label}</div>
      <div className={`tabular-nums text-sm font-bold ${color || 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

export default function Analytics() {
  const { analytics, setAnalytics } = useOrderStore();
  const [loading, setLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/paper/analytics');
        setAnalytics(await r.json());
      } catch {}
      setLoading(false);
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const handleReset = async () => {
    await fetch('/api/paper/reset', { method: 'POST' });
    await useOrderStore.getState().refreshAccount();
    const r = await fetch('/api/paper/analytics');
    setAnalytics(await r.json());
    setShowResetModal(false);
  };

  if (loading) return (
    <div className="p-3 space-y-2">
      {[1,2,3].map(i => <div key={i} className="h-12 bg-card rounded animate-pulse" />)}
    </div>
  );

  const a = analytics;

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin p-3 space-y-3">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Win Rate" value={`${a?.winRate ?? 0}%`} color={a?.winRate >= 50 ? 'text-up' : 'text-down'} />
        <StatCard label="Total Trades" value={a?.totalTrades ?? 0} />
        <StatCard label="Avg Profit" value={`₹${a?.avgProfit ?? 0}`} color={a?.avgProfit >= 0 ? 'text-up' : 'text-down'} />
        <StatCard label="Max Drawdown" value={`${a?.maxDrawdown ?? 0}%`} color="text-down" />
        <StatCard label="Best Trade" value={`₹${a?.bestTrade ?? 0}`} color="text-up" />
        <StatCard label="Worst Trade" value={`₹${a?.worstTrade ?? 0}`} color="text-down" />
      </div>

      {/* Equity curve */}
      {a?.equityCurve?.length > 1 && (
        <div className="bg-card rounded-lg p-3 border border-border">
          <div className="text-xs font-semibold text-text-secondary mb-2">Equity Curve</div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={a.equityCurve}>
              <Line type="monotone" dataKey="value" stroke="#1E88E5" strokeWidth={1.5} dot={false} />
              <YAxis domain={['auto', 'auto']} hide />
              <Tooltip
                contentStyle={{ background: '#1E2328', border: '1px solid #2A2E35', borderRadius: 6, fontSize: 11 }}
                formatter={v => [`₹${v.toLocaleString('en-IN')}`, 'Balance']}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily P&L */}
      {a?.dailyPnL?.length > 0 && (
        <div className="bg-card rounded-lg p-3 border border-border">
          <div className="text-xs font-semibold text-text-secondary mb-2">Daily P&L</div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={a.dailyPnL}>
              <Bar dataKey="pnl" fill="#0ECB81"
                label={false}
                cell={(entry) => entry.pnl >= 0 ? '#0ECB81' : '#F6465D'} />
              <ReferenceLine y={0} stroke="#2A2E35" />
              <XAxis dataKey="date" hide />
              <Tooltip
                contentStyle={{ background: '#1E2328', border: '1px solid #2A2E35', borderRadius: 6, fontSize: 11 }}
                formatter={v => [`₹${v}`, 'P&L']}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {a?.totalTrades === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-text-secondary">
          <TrendingUp className="w-8 h-8 opacity-20" />
          <span className="text-xs">No trades yet. Place your first paper trade!</span>
        </div>
      )}

      {/* Reset */}
      <button onClick={() => setShowResetModal(true)}
        className="flex items-center justify-center gap-2 w-full py-2 rounded-md border border-border text-text-secondary hover:text-down hover:border-down text-xs transition-colors">
        <RotateCcw className="w-3.5 h-3.5" />Reset Account to ₹10L
      </button>

      {/* Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-dropdown">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-warn" />
              <h3 className="font-semibold text-text-primary">Reset Account</h3>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              This will reset your paper balance to ₹10,00,000 and delete all trade history. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowResetModal(false)}
                className="flex-1 py-2 rounded-md border border-border text-sm text-text-secondary hover:bg-surface transition-colors">
                Cancel
              </button>
              <button onClick={handleReset}
                className="flex-1 py-2 rounded-md bg-down hover:bg-down/90 text-bg text-sm font-semibold transition-colors">
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}