/**
 * historicalFeed.js — TradingView UDF public datafeed fallback
 * No API key required. Used when MongoDB has no intraday candles (market closed).
 * Endpoint: https://symbol-search.tradingview.com (search)
 *           https://data.tradingview.com/history (OHLCV)
 */

const axios = require('axios');

const TV_BASE = 'https://data.tradingview.com';

const TF_MAP = {
  '1min': '1',
  '5min': '5',
  '15min': '15',
  '1hr': '60',
  '1D': 'D',
};

// Map your symbol to TradingView NSE format
function toTVSymbol(symbol) {
  // Indices
  if (symbol === 'NIFTY') return 'NSE:NIFTY50';
  if (symbol === 'BANKNIFTY') return 'NSE:BANKNIFTY';
  if (symbol === 'SENSEX') return 'BSE:SENSEX';
  return `NSE:${symbol}`;
}

/**
 * Fetch OHLCV from TradingView UDF
 * @param {string} symbol - your internal symbol
 * @param {string} timeframe - '1min','5min','15min','1hr','1D'
 * @param {number} limit - number of bars
 * @returns {Array} candles in your DB format
 */
async function fetchFromTV(symbol, timeframe, limit = 200) {
  const tvSym = toTVSymbol(symbol);
  const resolution = TF_MAP[timeframe] || 'D';
  const to = Math.floor(Date.now() / 1000);
  // Go back enough bars worth of seconds
  const secsPerBar = {
    '1': 60, '5': 300, '15': 900, '60': 3600, 'D': 86400,
  }[resolution] || 86400;
  const from = to - (limit * secsPerBar * 1.5); // 1.5x buffer for weekends/holidays

  const url = `${TV_BASE}/history`;
  const params = {
    symbol: tvSym,
    resolution,
    from,
    to,
  };

  const resp = await axios.get(url, {
    params,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.tradingview.com/',
      'Origin': 'https://www.tradingview.com',
    },
    timeout: 10000,
  });

  const d = resp.data;
  if (d.s !== 'ok' || !d.t || !d.t.length) {
    console.warn(`[TV] No data for ${tvSym} res=${resolution} status=${d.s}`);
    return [];
  }

  // Convert to your candle format (time in ms)
  const candles = d.t.map((t, i) => ({
    symbol,
    timeframe,
    time: t * 1000,
    open: d.o[i],
    high: d.h[i],
    low: d.l[i],
    close: d.c[i],
    volume: d.v[i] || 0,
    oi: 0,
    partial: false,
  }));

  return candles.slice(-limit);
}

module.exports = { fetchFromTV };