import React, { useEffect, useCallback } from 'react';
import socket from './socket';
import { useMarketStore } from './store/useMarketStore';
import { useChartStore } from './store/useChartStore';
import { useOrderStore } from './store/useOrderStore';
import TopBar from './components/Layout/TopBar';
import Sidebar from './components/Layout/Sidebar';
import StatusBar from './components/Layout/StatusBar';
import Chart from './components/Chart/Chart';
import OrderPanel from './components/Orders/OrderPanel';
import OptionChain from './components/OptionChain/OptionChain';

export default function App() {
  const { updateTick, updateOptionChain, updateScanner, setMarketStatus, setConnected, setServerStatus } = useMarketStore();
  const { symbol, updateLastCandle, setIndicators } = useChartStore();
  const { refreshAccount, refreshPositions, orderPanel } = useOrderStore();

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const { openOrderPanel, closeOrderPanel } = useOrderStore.getState();
    const sym = useChartStore.getState().symbol;
    if (e.key === 'b' || e.key === 'B') openOrderPanel(sym, 'BUY');
    if (e.key === 's' || e.key === 'S') openOrderPanel(sym, 'SELL');
    if (e.key === 'Escape') closeOrderPanel();
    if (e.key === '1') useChartStore.getState().setTimeframe('1min');
    if (e.key === '5') useChartStore.getState().setTimeframe('5min');
    if (e.key === 'f' || e.key === 'F') useChartStore.getState().setTimeframe('15min');
    if (e.key === 'h' || e.key === 'H') useChartStore.getState().setTimeframe('1hr');
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    // Connection events
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Market data
    socket.on('tick', (tick) => {
      if (tick?.symbol) updateTick(tick.symbol, tick);
    });

    // Option chains — any symbol can have one now (indices + F&O stocks),
    // so listen dynamically instead of hardcoding 3 index names.
    const handleOptionChain = (data) => {
      if (data?.symbol) updateOptionChain(data.symbol, data);
    };
    socket.onAny((event, payload) => {
      if (event.startsWith('optionChain:')) handleOptionChain(payload);
    });

    // Scanner
    socket.on('scanner', (results) => updateScanner(results));

    // Market status
    socket.on('marketStatus', ({ open, reason }) => setMarketStatus(open, reason));

    // Server status (backfill progress, etc.)
    socket.on('serverStatus', (status) => setServerStatus(status));

    // Server initial connection
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('tick');
      socket.offAny();
      socket.off('scanner');
      socket.off('marketStatus');
      socket.off('serverStatus');
    };
  }, [updateTick, updateOptionChain, updateScanner, setMarketStatus, setConnected, setServerStatus]);

  // Subscribe to candle updates for current chart symbol
  useEffect(() => {
    const handler = ({ symbol: sym, candle, indicators }) => {
      if (sym === symbol) {
        updateLastCandle(candle);
        if (indicators) setIndicators(indicators);
      }
    };
    socket.on('candle', handler);
    return () => socket.off('candle', handler);
  }, [symbol, updateLastCandle, setIndicators]);

  // Subscribe to watchlist symbols
  useEffect(() => {
    const { watchlist } = useMarketStore.getState();
    watchlist.forEach(sym => socket.emit('subscribe', sym));
    socket.emit('subscribe', 'NIFTY');
    socket.emit('subscribe', 'BANKNIFTY');
    socket.emit('subscribe', 'SENSEX');
  }, []);

  // Initial data load
  useEffect(() => {
    refreshAccount();
    refreshPositions();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden font-sans">
      {/* Top Bar */}
      <TopBar />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Center: Chart + Option Chain */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Chart />
          <OptionChain />
        </div>

        {/* Right: Order Panel */}
        <div className="w-80 flex-shrink-0 border-l border-border overflow-hidden">
          <OrderPanel />
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
