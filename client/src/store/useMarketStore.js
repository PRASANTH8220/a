import { create } from 'zustand';

export const useMarketStore = create((set, get) => ({
  // Tick data: { [symbol]: tick }
  ticks: {},

  // Watchlist
  watchlist: ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'NIFTY', 'BANKNIFTY'],

  // Index ticks
  indexTicks: {
    NIFTY: null,
    BANKNIFTY: null,
    SENSEX: null,
  },

  // Option chain data
  optionChains: {},

  // Scanner results
  scannerResults: {
    topGainers: [],
    topLosers: [],
    mostActive: [],
    oiBuildup: [],
    oiUnwinding: [],
  },

  // Market status
  marketOpen: false,
  marketStatusReason: null,

  // Connection
  connected: false,
  lastTickTime: null,

  // Server status
  serverStatus: {
    backfill: { complete: false, running: false, done: 0, total: 0 },
    circuitBreakerSymbols: [],
  },

  // Actions
  updateTick: (symbol, tick) => set(state => ({
    ticks: { ...state.ticks, [symbol]: { ...tick, prevLtp: state.ticks[symbol]?.ltp } },
    lastTickTime: Date.now(),
    indexTicks: ['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(symbol)
      ? { ...state.indexTicks, [symbol]: tick }
      : state.indexTicks,
  })),

  updateOptionChain: (symbol, data) => set(state => ({
    optionChains: { ...state.optionChains, [symbol]: data },
  })),

  updateScanner: (results) => set({ scannerResults: results }),

  setMarketStatus: (open, reason) => set({ marketOpen: open, marketStatusReason: reason }),

  setConnected: (connected) => set({ connected }),

  setServerStatus: (status) => set({ serverStatus: status }),

  addToWatchlist: (symbol) => set(state => ({
    watchlist: state.watchlist.includes(symbol)
      ? state.watchlist
      : [...state.watchlist, symbol],
  })),

  removeFromWatchlist: (symbol) => set(state => ({
    watchlist: state.watchlist.filter(s => s !== symbol),
  })),

  reorderWatchlist: (newOrder) => set({ watchlist: newOrder }),

  getTick: (symbol) => get().ticks[symbol] || null,
}));
