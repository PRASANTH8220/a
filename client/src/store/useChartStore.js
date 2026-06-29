import { create } from 'zustand';

export const useChartStore = create((set, get) => ({
  symbol: 'NIFTY',
  timeframe: '1D',
  candles: [],
  indicators: {
    rsi: [],
    macd: [],
    macdSignal: [],
    macdHistogram: [],
    bbUpper: [],
    bbMiddle: [],
    bbLower: [],
    ema9: [],
    ema20: [],
    ema50: [],
    ema200: [],
    vwap: [],
    superTrendValue: [],
    superTrendDirection: [],
  },
  enabledIndicators: {
    vwap: false,
    superTrend: false,
    ema: false,
    bb: false,
    rsi: false,
    macd: false,
  },
  isLoading: false,
  serverStartDate: null,
  hasMore: true,

  setSymbol: (symbol) => set({ symbol, candles: [], hasMore: true }),
  setTimeframe: (timeframe) => set({ timeframe, candles: [], hasMore: true }),
  setCandles: (candles) => set({ candles }),
  appendCandles: (older) => set(state => ({
    candles: [...older, ...state.candles],
    hasMore: older.length >= 200,
  })),
  updateLastCandle: (candle) => set(state => {
    const candles = [...state.candles];
    const lastIdx = candles.length - 1;
    if (lastIdx >= 0 && candles[lastIdx].time === candle.time) {
      candles[lastIdx] = candle;
    } else {
      candles.push(candle);
    }
    return { candles };
  }),
  setIndicators: (indicators) => set({ indicators }),
  toggleIndicator: (name) => set(state => ({
    enabledIndicators: {
      ...state.enabledIndicators,
      [name]: !state.enabledIndicators[name],
    },
  })),
  setLoading: (isLoading) => set({ isLoading }),
  setServerStartDate: (date) => set({ serverStartDate: date }),
}));
