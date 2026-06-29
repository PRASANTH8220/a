import { create } from 'zustand';

export const useOrderStore = create((set, get) => ({
  // Paper trading account
  account: {
    totalCapital: 1000000,
    usedMargin: 0,
    availableBalance: 1000000,
    unrealizedPnL: 0,
    realizedPnL: 0,
    dayPnL: 0,
  },

  // Positions
  positions: [],

  // Orders (pending)
  pendingOrders: [],

  // Trade history
  tradeHistory: [],

  // Order panel state
  orderPanel: {
    open: false,
    side: 'BUY', // BUY | SELL
    symbol: '',
    optionType: 'EQ', // EQ | CE | PE — EQ = plain equity intraday/delivery buy-sell
    strike: null,
    expiry: null,
    orderType: 'MARKET',
    product: 'MIS',
    qty: 1,
    limitPrice: '',
    triggerPrice: '',
  },

  // Analytics
  analytics: null,

  // UI
  activeTab: 'watchlist', // watchlist | scanner | positions | orders | analytics

  // Actions
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setPendingOrders: (orders) => set({ pendingOrders: orders }),
  setTradeHistory: (history) => set({ tradeHistory: history }),
  setAnalytics: (analytics) => set({ analytics }),

  openOrderPanel: (symbol, side = 'BUY', extra = {}) => set(state => ({
    orderPanel: {
      ...state.orderPanel,
      open: true,
      symbol,
      side,
      optionType: extra.optionType || 'EQ',
      strike: extra.strike ?? null,
      expiry: extra.expiry ?? null,
    },
  })),
  closeOrderPanel: () => set(state => ({
    orderPanel: { ...state.orderPanel, open: false },
  })),
  updateOrderPanel: (updates) => set(state => ({
    orderPanel: { ...state.orderPanel, ...updates },
  })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  // Refresh account from API
  refreshAccount: async () => {
    try {
      const resp = await fetch('/api/paper/account');
      const data = await resp.json();
      set({ account: data });
    } catch (err) {
      console.error('[OrderStore] Error refreshing account:', err);
    }
  },

  // Refresh positions
  refreshPositions: async () => {
    try {
      const resp = await fetch('/api/paper/positions');
      const data = await resp.json();
      set({ positions: data });
    } catch (err) {
      console.error('[OrderStore] Error refreshing positions:', err);
    }
  },

  // Place order
  placeOrder: async (orderData) => {
    try {
      const resp = await fetch('/api/paper/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });
      const result = await resp.json();
      if (result.success) {
        await get().refreshAccount();
        await get().refreshPositions();
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // Close position
  closePosition: async (tradeId) => {
    try {
      const resp = await fetch('/api/paper/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId }),
      });
      const result = await resp.json();
      if (result.success) {
        await get().refreshAccount();
        await get().refreshPositions();
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
}));
