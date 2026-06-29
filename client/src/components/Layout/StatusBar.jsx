import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Database, Activity, AlertCircle } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';

export default function StatusBar() {
  const { connected, lastTickTime, serverStatus } = useMarketStore();
  const [status, setStatus] = useState(null);
  const [tickRate, setTickRate] = useState(0);
  const [tickCount, setTickCount] = useState(0);

  useEffect(() => {
    let lastCount = tickCount;
    const interval = setInterval(() => {
      setTickRate(tickCount - lastCount);
      lastCount = tickCount;
    }, 1000);
    return () => clearInterval(interval);
  }, [tickCount]);

  // Fetch server status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/status');
        const data = await r.json();
        setStatus(data);
      } catch {}
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => clearInterval(t);
  }, []);

  const lastTickStr = lastTickTime
    ? `${((Date.now() - lastTickTime) / 1000).toFixed(0)}s ago`
    : 'No data';

  const backfill = serverStatus?.backfill;
  const cbSymbols = serverStatus?.circuitBreakerSymbols || [];

  // Market session based on IST time
  const getSession = () => {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const h = ist.getHours(), m = ist.getMinutes();
    if (h === 9 && m < 15) return { label: 'Pre-open', color: 'text-warn' };
    if ((h === 9 && m >= 15) || (h >= 10 && h < 15) || (h === 15 && m <= 29)) return { label: 'Normal', color: 'text-up' };
    if (h === 15 && m >= 30 && m < 40) return { label: 'Closing', color: 'text-warn' };
    return { label: 'Closed', color: 'text-text-secondary' };
  };
  const session = getSession();

  return (
    <div className="h-7 flex-shrink-0 bg-surface border-t border-border flex items-center px-4 gap-4 text-xs text-text-secondary overflow-hidden">
      {/* Connection */}
      <div className={`flex items-center gap-1.5 ${connected ? 'text-up' : 'text-down'}`}>
        {connected
          ? <><span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse-glow" /><Wifi className="w-3 h-3" />Connected</>
          : <><WifiOff className="w-3 h-3" />Reconnecting...</>
        }
      </div>

      <span className="text-border">|</span>

      {/* Last tick */}
      <span>Last tick: <span className="text-text-primary tabular-nums">{lastTickStr}</span></span>

      <span className="text-border">|</span>

      {/* Session */}
      <span>Session: <span className={`font-medium ${session.color}`}>{session.label}</span></span>

      <span className="text-border">|</span>

      {/* Redis/Mongo */}
      <div className="flex items-center gap-1.5">
        <Database className="w-3 h-3" />
        <span className={status?.redisOk ? 'text-up' : 'text-down'}>Redis</span>
        <span className="text-border">/</span>
        <span className={status?.mongoOk ? 'text-up' : 'text-down'}>Mongo</span>
      </div>

      <span className="text-border">|</span>

      {/* Backfill */}
      <div className="flex items-center gap-1.5">
        <Activity className="w-3 h-3" />
        {backfill?.complete
          ? <span className="text-up">Backfill: complete</span>
          : backfill?.running
            ? <span className="text-warn">Backfilling {backfill.done}/{backfill.total}</span>
            : <span>Backfill: idle</span>
        }
      </div>

      {/* Circuit breaker symbols */}
      {cbSymbols.length > 0 && (
        <>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1 text-warn">
            <AlertCircle className="w-3 h-3" />
            <span>{cbSymbols.length} symbol{cbSymbols.length > 1 ? 's' : ''} retrying</span>
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connected clients */}
      <span>{status?.connectedClients || 0} clients</span>
    </div>
  );
}
