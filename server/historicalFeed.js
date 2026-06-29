/**
 * historicalFeed.js — NSE chart data fallback (no cookies needed for indices)
 * For equities: uses NSE historical API (needs cookies)
 * For indices: uses NSE chart-databyindex (public)
 */

const axios = require('axios');
const { getHeaders } = require('./cookie');

// NSE intraday resolutions (minutes)
const TF_MINUTES = { '1min': 1, '5min': 5, '15min': 15, '1hr': 60, '1D': 'D' };

const INDEX_MAP = {
  'NIFTY':     'NIFTY 50',
  'BANKNIFTY': 'NIFTY BANK',
  'SENSEX':    'SENSEX',
  'NIFTY MIDCAP SELECT': 'NIFTY MIDCAP SELECT',
};

/**
 * NSE indices: chart-databyindex gives today's 1-min OHLCV (public, no auth)
 * Returns array of 1-min candles for today
 */
async function fetchIndexIntraday(symbol) {
  const indexName = INDEX_MAP[symbol] || symbol;
  const url = `https://www.nseindia.com/api/chart-databyindex?index=${encodeURIComponent(indexName)}&indices=true`;
  const resp = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.nseindia.com/',
      'Accept': 'application/json',
    },
    timeout: 10000,
  });

  const raw = resp.data?.grapthData || resp.data?.graphData || [];
  // Each entry: [timestamp_ms, price]  — 1-min points
  return raw.map(([t, close]) => ({
    symbol,
    timeframe: '1min',
    time: t,
    open: close, high: close, low: close, close,
    volume: 0, oi: 0, partial: false,
  })).filter(c => c.close > 0);
}

/**
 * NSE equity: historical daily OHLCV (needs cookies, already in cookie.js)
 */
async function fetchEquityDaily(symbol, days = 365) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = d => `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  const url = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&series=EQ&from=${fmt(from)}&to=${fmt(to)}`;
  const resp = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
  const rows = resp.data?.data || [];
  return rows.map(r => ({
    symbol, timeframe: '1D',
    time: new Date(r.CH_TIMESTAMP).setHours(0,0,0,0),
    open:   parseFloat(r.CH_OPENING_PRICE || 0),
    high:   parseFloat(r.CH_TRADE_HIGH_PRICE || 0),
    low:    parseFloat(r.CH_TRADE_LOW_PRICE || 0),
    close:  parseFloat(r.CH_CLOSING_PRICE || 0),
    volume: parseInt(r.CH_TOT_TRADED_QTY || 0),
    oi: 0, partial: false,
  })).filter(c => c.close > 0).reverse();
}

/**
 * Aggregate 1-min candles → higher timeframe
 */
function aggregate(candles1min, timeframe) {
  if (timeframe === '1min') return candles1min;
  const mins = TF_MINUTES[timeframe];
  if (!mins || mins === 'D') return candles1min;
  const ms = mins * 60 * 1000;
  const buckets = {};
  for (const c of candles1min) {
    const key = Math.floor(c.time / ms) * ms;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(c);
  }
  return Object.entries(buckets).sort((a,b) => a[0]-b[0]).map(([t, cs]) => ({
    symbol: cs[0].symbol, timeframe,
    time: parseInt(t),
    open:  cs[0].open,
    high:  Math.max(...cs.map(c => c.high)),
    low:   Math.min(...cs.map(c => c.low)),
    close: cs[cs.length-1].close,
    volume: cs.reduce((s,c) => s + c.volume, 0),
    oi: 0, partial: false,
  }));
}

/**
 * Main entry: fetch candles for any symbol/timeframe
 */
async function fetchFromNSE(symbol, timeframe, limit = 200) {
  const isIndex = !!INDEX_MAP[symbol];

  if (timeframe === '1D') {
    // Daily: works for equity via historical API
    if (isIndex) return []; // indices 1D handled by backfill already
    try {
      const candles = await fetchEquityDaily(symbol, 365);
      return candles.slice(-limit);
    } catch (err) {
      console.error(`[NSE] Daily fetch failed for ${symbol}:`, err.message);
      return [];
    }
  }

  // Intraday: only indices supported without extra auth
  if (!isIndex) {
    // For equities, use NSE chart endpoint
    try {
      const url = `https://www.nseindia.com/api/chart-databyindex?index=${encodeURIComponent(symbol + 'EQ')}`;
      const resp = await axios.get(url, { headers: getHeaders(), timeout: 10000 });
      const raw = resp.data?.grapthData || resp.data?.graphData || [];
      const min1 = raw.map(([t, close]) => ({
        symbol, timeframe: '1min', time: t,
        open: close, high: close, low: close, close,
        volume: 0, oi: 0, partial: false,
      })).filter(c => c.close > 0);
      return aggregate(min1, timeframe).slice(-limit);
    } catch (err) {
      console.error(`[NSE] Equity chart fetch failed for ${symbol}:`, err.message);
      return [];
    }
  }

  // Index intraday
  try {
    const min1 = await fetchIndexIntraday(symbol);
    return aggregate(min1, timeframe).slice(-limit);
  } catch (err) {
    console.error(`[NSE] Index chart fetch failed for ${symbol}:`, err.message);
    return [];
  }
}

module.exports = { fetchFromNSE };