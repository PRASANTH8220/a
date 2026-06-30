/**
 * historicalFeed.js — NSE chart data with Yahoo Finance fallback
 * For equities: NSE historical API (needs cookies) → Yahoo Finance (no cookies)
 * For indices:  NSE chart-databyindex (public) → Yahoo Finance (no cookies)
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

// Yahoo Finance symbol overrides for NSE symbols that don't follow SYMBOL.NS pattern
const YAHOO_SYMBOL_MAP = {
  // Indices
  'NIFTY':              '^NSEI',
  'BANKNIFTY':          '^NSEBANK',
  'SENSEX':             '^BSESN',
  'NIFTY MIDCAP SELECT':'NIFTY_MID_SELECT.NS',
  // Equity overrides (NSE symbol → Yahoo symbol)
  'M&M':                'M%26M.NS',
  'BAJAJ-AUTO':         'BAJAJ-AUTO.NS',
  'NAUKRI':             'NAUKRI.NS',
  'JIOFIN':             'JIOFIN.NS',
  'LICI':               'LICI.NS',
  'MAXLIFE':            'MAXLIFE.NS',
  'PNBHOUSING':         'PNBHOUSING.NS',
  'SONACOMS':           'SONACOMS.NS',
};

function toYahooSymbol(nseSymbol) {
  if (YAHOO_SYMBOL_MAP[nseSymbol]) return YAHOO_SYMBOL_MAP[nseSymbol];
  return `${nseSymbol}.NS`;
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
  return Object.entries(buckets).sort((a, b) => a[0] - b[0]).map(([t, cs]) => ({
    symbol: cs[0].symbol, timeframe,
    time: parseInt(t),
    open:   cs[0].open,
    high:   Math.max(...cs.map(c => c.high)),
    low:    Math.min(...cs.map(c => c.low)),
    close:  cs[cs.length - 1].close,
    volume: cs.reduce((s, c) => s + c.volume, 0),
    oi: 0, partial: false,
  }));
}

/**
 * Yahoo Finance: fetch intraday 1-min candles for today (up to 7 days back)
 */
/**
 * Filter candles to NSE market hours only: 09:15–15:30 IST.
 * Yahoo returns pre-market (04:00 IST) and post-market junk — strip it.
 */
function filterMarketHours(candles) {
  return candles.filter(c => {
    // totalMinsIST = minutes elapsed since midnight IST
    const totalMinsIST = (new Date(c.time).getUTCHours() * 60 + new Date(c.time).getUTCMinutes() + 330) % 1440;
    return totalMinsIST >= 555 && totalMinsIST <= 930; // 09:15–15:30
  });
}

async function fetchYahooIntraday(symbol) {
  const yahooSym = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1m&range=1d&includePrePost=false`;
  const resp = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    timeout: 12000,
  });
  const result = resp.data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const raw = timestamps.map((ts, i) => ({
    symbol, timeframe: '1min',
    time: ts * 1000,
    open:   parseFloat((q.open?.[i]  || 0).toFixed(2)),
    high:   parseFloat((q.high?.[i]  || 0).toFixed(2)),
    low:    parseFloat((q.low?.[i]   || 0).toFixed(2)),
    close:  parseFloat((q.close?.[i] || 0).toFixed(2)),
    volume: parseInt(q.volume?.[i] || 0),
    oi: 0, partial: false,
  })).filter(c => c.close > 0);
  return filterMarketHours(raw);
}

/**
 * Yahoo Finance: fetch daily OHLCV (5 months back — sufficient for indicators)
 */
async function fetchYahooDaily(symbol, days = 365) {
  const yahooSym = toYahooSymbol(symbol);
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - days * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&period1=${period1}&period2=${period2}`;
  const resp = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    timeout: 12000,
  });
  const result = resp.data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  return timestamps.map((ts, i) => ({
    symbol, timeframe: '1D',
    time: new Date(ts * 1000).setHours(0, 0, 0, 0),
    open:   parseFloat((q.open?.[i]  || 0).toFixed(2)),
    high:   parseFloat((q.high?.[i]  || 0).toFixed(2)),
    low:    parseFloat((q.low?.[i]   || 0).toFixed(2)),
    close:  parseFloat((q.close?.[i] || 0).toFixed(2)),
    volume: parseInt(q.volume?.[i] || 0),
    oi: 0, partial: false,
  })).filter(c => c.close > 0);
}

/**
 * NSE indices: chart-databyindex gives today's 1-min OHLCV (public, no auth)
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
  return raw.map(([t, close]) => ({
    symbol, timeframe: '1min', time: t,
    open: close, high: close, low: close, close,
    volume: 0, oi: 0, partial: false,
  })).filter(c => c.close > 0);
}

/**
 * NSE equity: historical daily OHLCV (needs cookies)
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
 * Main entry: fetch candles for any symbol/timeframe
 * Priority: NSE (primary) → Yahoo Finance (fallback)
 */
async function fetchFromNSE(symbol, timeframe, limit = 200) {
  const isIndex = !!INDEX_MAP[symbol];

  // ── DAILY ──────────────────────────────────────────────────────────────────
  if (timeframe === '1D') {
    if (isIndex) {
      // Indices 1D: try Yahoo directly (NSE indices history needs special endpoint)
      try {
        const candles = await fetchYahooDaily(symbol, 365);
        console.log(`[Feed] Index 1D ${symbol} via Yahoo: ${candles.length} candles`);
        return candles.slice(-limit);
      } catch (err) {
        console.error(`[Feed] Yahoo daily failed for index ${symbol}:`, err.message);
        return [];
      }
    }
    // Equity 1D: NSE first, Yahoo fallback
    try {
      const candles = await fetchEquityDaily(symbol, 365);
      if (candles.length) return candles.slice(-limit);
    } catch (err) {
      console.warn(`[Feed] NSE daily failed for ${symbol} (${err.message}), trying Yahoo...`);
    }
    try {
      const candles = await fetchYahooDaily(symbol, 365);
      console.log(`[Feed] Equity 1D ${symbol} via Yahoo: ${candles.length} candles`);
      return candles.slice(-limit);
    } catch (err) {
      console.error(`[Feed] Yahoo daily also failed for ${symbol}:`, err.message);
      return [];
    }
  }

  // ── INTRADAY ───────────────────────────────────────────────────────────────
  if (isIndex) {
    // Index intraday: NSE public endpoint first, Yahoo fallback
    try {
      const min1 = await fetchIndexIntraday(symbol);
      if (min1.length) return aggregate(min1, timeframe).slice(-limit);
    } catch (err) {
      console.warn(`[Feed] NSE intraday failed for index ${symbol} (${err.message}), trying Yahoo...`);
    }
    try {
      const min1 = await fetchYahooIntraday(symbol);
      console.log(`[Feed] Index intraday ${symbol} via Yahoo: ${min1.length} 1min candles`);
      return aggregate(min1, timeframe).slice(-limit);
    } catch (err) {
      console.error(`[Feed] Yahoo intraday also failed for index ${symbol}:`, err.message);
      return [];
    }
  }

  // Equity intraday: NSE chart endpoint first, Yahoo fallback
  try {
    const url = `https://www.nseindia.com/api/chart-databyindex?index=${encodeURIComponent(symbol + 'EQ')}`;
    const resp = await axios.get(url, { headers: getHeaders(), timeout: 10000 });
    const raw = resp.data?.grapthData || resp.data?.graphData || [];
    const min1 = raw.map(([t, close]) => ({
      symbol, timeframe: '1min', time: t,
      open: close, high: close, low: close, close,
      volume: 0, oi: 0, partial: false,
    })).filter(c => c.close > 0);
    if (min1.length) return aggregate(min1, timeframe).slice(-limit);
  } catch (err) {
    console.warn(`[Feed] NSE equity intraday failed for ${symbol} (${err.message}), trying Yahoo...`);
  }

  try {
    const min1 = await fetchYahooIntraday(symbol);
    console.log(`[Feed] Equity intraday ${symbol} via Yahoo: ${min1.length} 1min candles`);
    return aggregate(min1, timeframe).slice(-limit);
  } catch (err) {
    console.error(`[Feed] Yahoo intraday also failed for ${symbol}:`, err.message);
    return [];
  }
}

/**
 * Yahoo Finance: fetch intraday candles for a SPECIFIC past date.
 * Yahoo supports:
 *   interval=1m  → up to 7 days back
 *   interval=5m  → up to 60 days back
 *   interval=15m → up to 60 days back
 *   interval=1h  → up to 730 days back
 * We fetch the finest available granularity for the date and aggregate up.
 */
async function fetchYahooIntradayForDate(symbol, dateStr, timeframe) {
  // dateStr = 'YYYY-MM-DD'
  const date = new Date(dateStr + 'T00:00:00+05:30'); // IST midnight
  const dayStart = Math.floor(date.getTime() / 1000);
  const dayEnd = dayStart + 86400; // next midnight

  const daysAgo = Math.floor((Date.now() / 1000 - dayStart) / 86400);

  // Pick finest Yahoo interval available for this date
  let yahooInterval;
  if (daysAgo <= 7)  yahooInterval = '1m';
  else if (daysAgo <= 60) yahooInterval = '5m';
  else yahooInterval = '1h'; // up to 730 days

  const yahooSym = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}` +
    `?interval=${yahooInterval}&period1=${dayStart}&period2=${dayEnd}&includePrePost=false`;

  const resp = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    timeout: 15000,
  });

  const result = resp.data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};

  // Build base candles at Yahoo's finest interval
  const baseInterval = yahooInterval === '1m' ? '1min'
    : yahooInterval === '5m' ? '5min' : '1hr';

  const baseCandels = timestamps.map((ts, i) => ({
    symbol, timeframe: baseInterval,
    time: ts * 1000,
    open:   parseFloat((q.open?.[i]  || 0).toFixed(2)),
    high:   parseFloat((q.high?.[i]  || 0).toFixed(2)),
    low:    parseFloat((q.low?.[i]   || 0).toFixed(2)),
    close:  parseFloat((q.close?.[i] || 0).toFixed(2)),
    volume: parseInt(q.volume?.[i] || 0),
    oi: 0, partial: false,
  })).filter(c => c.close > 0);

  // Strip pre/post market noise, then aggregate to requested timeframe
  const filtered = filterMarketHours(baseCandels);
  return aggregate(filtered, timeframe);
}

module.exports = { fetchFromNSE, fetchYahooIntradayForDate };