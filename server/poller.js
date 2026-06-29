/**
 * poller.js — NSE live data polling engine
 * Implements: cookie-death detection, circuit breaker, batched polling,
 * exchange timestamps, daily flush guard, holiday check
 */

const axios = require('axios');
const cron = require('node-cron');
const dayjs = require('dayjs');
const { getHeaders, refreshCookies } = require('./cookie');
const { isTradingDay, getTodayHolidayName } = require('./holidays');
const { NIFTY50_SYMBOLS, NIFTY100_SYMBOLS, NIFTY500_SYMBOLS, FNO_SYMBOLS, INDICES } = require('./symbols');
const { calculateGreeks } = require('./greeks');
const { updateTick } = require('./scanner');

let redis = null;
let io = null;
let isPolling = false;

// Circuit breaker state per symbol
const failureCounts = new Map();
const backoffTimers = new Map();
const BACKOFF_DELAYS = [2000, 4000, 8000, 16000, 60000];

// Latest tick cache for option chain
const optionChainCache = new Map();

// Flag for poller stopped (used by candle.js for 1D aggregation)
let pollerStopCallback = null;

function init(redisClient, socketIO, onStop) {
  redis = redisClient;
  io = socketIO;
  pollerStopCallback = onStop;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Detect if response indicates cookie death (non-JSON or non-200)
 */
function isCookieDead(response) {
  const contentType = response.headers?.['content-type'] || '';
  if (response.status !== 200) return true;
  if (contentType.includes('text/html')) return true;
  return false;
}

/**
 * Get circuit breaker delay for a symbol
 */
function getBackoffDelay(symbol) {
  const count = failureCounts.get(symbol) || 0;
  const idx = Math.min(count, BACKOFF_DELAYS.length - 1);
  return BACKOFF_DELAYS[idx];
}

function recordFailure(symbol) {
  failureCounts.set(symbol, (failureCounts.get(symbol) || 0) + 1);
}

function recordSuccess(symbol) {
  failureCounts.delete(symbol);
  backoffTimers.delete(symbol);
}

/**
 * Store tick in Redis with ZADD
 */
async function storeTick(symbol, tick) {
  const key = `ticks:${symbol}`;
  const ts = tick.timestamp || Date.now();
  const score = ts;
  await redis.zadd(key, score, JSON.stringify(tick));
  // Set TTL: 1 day
  await redis.expire(key, 86400);
}

/**
 * Emit tick to Socket.IO room and update scanner
 */
function emitTick(symbol, tick) {
  if (io) {
    io.to(symbol).emit('tick', tick);
  }
  updateTick(symbol, tick);
}

/**
 * Parse NSE equity/indices response into tick
 */
function parseEquityTick(row) {
  return {
    symbol: row.symbol || row.index,
    ltp: parseFloat(row.lastPrice || row.last || 0),
    open: parseFloat(row.open || 0),
    high: parseFloat(row.dayHigh || row.high || 0),
    low: parseFloat(row.dayLow || row.low || 0),
    volume: parseInt(row.totalTradedVolume || row.yearHigh || 0),
    oi: parseInt(row.totalSellQuantity || 0),
    iv: 0,
    timestamp: row.lastUpdateTime ? new Date(row.lastUpdateTime).getTime() : Date.now(),
  };
}

/**
 * Poll NSE equity stockIndices endpoint
 */
async function pollEquityIndex(indexParam) {
  try {
    const url = `https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(indexParam)}`;
    const response = await axios.get(url, {
      headers: getHeaders(),
      timeout: 8000,
      validateStatus: () => true,
    });

    if (isCookieDead(response)) {
      console.warn(`[Poller] Cookie death detected on ${indexParam}. Refreshing...`);
      await refreshCookies();
      return;
    }

    const data = response.data?.data || [];
    for (const row of data) {
      if (!row.symbol) continue;
      const tick = parseEquityTick(row);
      await storeTick(tick.symbol, tick);
      emitTick(tick.symbol, tick);
    }

    // Also emit the index itself
    const meta = response.data?.metadata || response.data?.marketStatus;
    if (meta) {
      const idxSymbol = indexParam.replace('NIFTY ', 'NIFTY').replace('SECURITIES IN F&O', 'FNO');
      const idxTick = {
        symbol: idxSymbol,
        ltp: parseFloat(response.data?.data?.[0]?.lastPrice || 0),
        open: parseFloat(response.data?.data?.[0]?.previousClose || 0),
        timestamp: Date.now(),
      };
      if (idxTick.ltp > 0) emitTick(idxSymbol, idxTick);
    }
  } catch (err) {
    console.error(`[Poller] Error polling equity index ${indexParam}:`, err.message);
  }
}

/**
 * On-demand snapshot quote — fetched straight from NSE outside the normal
 * poller loop. This is what powers LTP when the market is closed / it's a
 * holiday / the server just started: NSE's quote APIs keep serving the last
 * traded price (the same number you'd see on nseindia.com after hours) even
 * when nothing is actively trading. Our NSE cookie session is refreshed via
 * a 25-min cron in cookie.js regardless of market hours, so this works any
 * time of day. Used as a fallback by GET /api/quote/:symbol.
 */
async function fetchSnapshotQuote(symbol) {
  const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'NIFTY MIDCAP SELECT'];
  const YAHOO_INDEX_MAP = {
    'NIFTY': '^NSEI',
    'BANKNIFTY': '^NSEBANK',
    'NIFTY MIDCAP SELECT': 'NIFTY_MID_SELECT.NS',
    'SENSEX': '^BSESN',
  };

  // Helper: fetch LTP from Yahoo Finance (no cookies needed)
  async function fetchFromYahoo(sym) {
    const yahooSym = YAHOO_INDEX_MAP[sym] || `${sym}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`;
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      timeout: 8000,
    });
    const meta = resp.data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return {
      symbol: sym,
      ltp: parseFloat(meta.regularMarketPrice.toFixed(2)),
      open: parseFloat((meta.regularMarketOpen || 0).toFixed(2)),
      high: parseFloat((meta.regularMarketDayHigh || 0).toFixed(2)),
      low: parseFloat((meta.regularMarketDayLow || 0).toFixed(2)),
      volume: parseInt(meta.regularMarketVolume || 0),
      oi: 0,
      timestamp: Date.now(),
      source: 'yahoo',
    };
  }

  try {
    if (INDEX_SYMBOLS.includes(symbol)) {
      const url = 'https://www.nseindia.com/api/allIndices';
      const response = await axios.get(url, {
        headers: getHeaders(),
        timeout: 8000,
        validateStatus: () => true,
      });
      if (isCookieDead(response)) {
        await refreshCookies();
        // Fall through to Yahoo below
      } else {
        const row = (response.data?.data || []).find(
          r => r.index === symbol || r.indexSymbol === symbol
        );
        if (row) {
          const ltp = parseFloat(row.last || row.lastPrice || 0);
          if (ltp) return {
            symbol,
            ltp,
            open: parseFloat(row.open || 0),
            high: parseFloat(row.high || row.dayHigh || 0),
            low: parseFloat(row.low || row.dayLow || 0),
            volume: 0,
            oi: 0,
            timestamp: Date.now(),
          };
        }
      }
    } else {
      const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
      const response = await axios.get(url, {
        headers: getHeaders(),
        timeout: 8000,
        validateStatus: () => true,
      });
      if (isCookieDead(response)) {
        await refreshCookies();
        // Fall through to Yahoo below
      } else {
        const priceInfo = response.data?.priceInfo || {};
        const ltp = parseFloat(priceInfo.lastPrice || priceInfo.close || 0);
        if (ltp) return {
          symbol,
          ltp,
          open: parseFloat(priceInfo.open || 0),
          high: parseFloat(priceInfo.intraDayHighLow?.max || priceInfo.weekHighLow?.max || 0),
          low: parseFloat(priceInfo.intraDayHighLow?.min || priceInfo.weekHighLow?.min || 0),
          volume: parseInt(response.data?.securityWiseDP?.quantityTraded || 0),
          oi: 0,
          timestamp: Date.now(),
        };
      }
    }
  } catch (err) {
    console.warn(`[Poller] NSE snapshot failed for ${symbol} (${err.message}), trying Yahoo...`);
  }

  // Yahoo fallback — works without cookies, no IP blocking
  try {
    const yahooData = await fetchFromYahoo(symbol);
    if (yahooData) return yahooData;
  } catch (err) {
    console.error(`[Poller] Yahoo snapshot also failed for ${symbol}: ${err.message}`);
  }

  return null;
}

/**
 * Poll NSE option chain endpoint
 * @param {string} symbol
 * @param {{equity?: boolean}} opts - pass { equity: true } for F&O *stock*
 *   option chains (option-chain-equities); omit/false for index chains
 *   (option-chain-indices) like NIFTY/BANKNIFTY/NIFTY MIDCAP SELECT.
 */
async function pollOptionChain(symbol, opts = {}) {
  const endpoint = opts.equity ? 'option-chain-equities' : 'option-chain-indices';
  try {
    const url = `https://www.nseindia.com/api/${endpoint}?symbol=${encodeURIComponent(symbol)}`;
    const response = await axios.get(url, {
      headers: getHeaders(),
      timeout: 10000,
      validateStatus: () => true,
    });

    if (isCookieDead(response)) {
      console.warn(`[Poller] Cookie death on option chain ${symbol}. Refreshing...`);
      await refreshCookies();
      return;
    }

    const data = response.data;
    if (!data?.records?.data) return;

    const underlyingLTP = data.records.underlyingValue || 0;
    const expiryDates = data.records.expiryDates || [];
    const timestamp = Date.now();

    // Store underlying tick
    const undTick = {
      symbol,
      ltp: underlyingLTP,
      open: underlyingLTP,
      high: underlyingLTP,
      low: underlyingLTP,
      volume: 0,
      oi: 0,
      iv: 0,
      timestamp,
    };
    await storeTick(symbol, undTick);
    emitTick(symbol, undTick);

    // Process option chain
    const processedChain = [];
    for (const item of data.records.data) {
      const strike = item.strikePrice;
      const expiry = item.expiryDate;
      const daysToExpiry = Math.max(
        Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24)),
        0
      );

      const row = { strike, expiry, daysToExpiry };

      if (item.CE) {
        const ce = item.CE;
        const iv = (ce.impliedVolatility || 0) / 100;
        row.CE = {
          ltp: ce.lastPrice || 0,
          bid: ce.bidprice || 0,
          ask: ce.askPrice || 0,
          oi: ce.openInterest || 0,
          volume: ce.totalTradedVolume || 0,
          iv: ce.impliedVolatility || 0,
          greeks: iv > 0 ? calculateGreeks(underlyingLTP, strike, daysToExpiry, iv, 'CE') : {},
        };
      }

      if (item.PE) {
        const pe = item.PE;
        const iv = (pe.impliedVolatility || 0) / 100;
        row.PE = {
          ltp: pe.lastPrice || 0,
          bid: pe.bidprice || 0,
          ask: pe.askPrice || 0,
          oi: pe.openInterest || 0,
          volume: pe.totalTradedVolume || 0,
          iv: pe.impliedVolatility || 0,
          greeks: iv > 0 ? calculateGreeks(underlyingLTP, strike, daysToExpiry, iv, 'PE') : {},
        };
      }

      processedChain.push(row);
    }

    // Calculate PCR and Max Pain
    const totalCEOI = processedChain.reduce((s, r) => s + (r.CE?.oi || 0), 0);
    const totalPEOI = processedChain.reduce((s, r) => s + (r.PE?.oi || 0), 0);
    const pcr = totalCEOI > 0 ? parseFloat((totalPEOI / totalCEOI).toFixed(2)) : 0;

    // Max pain: strike where total OI loss is minimized
    let maxPainStrike = 0;
    let minLoss = Infinity;
    for (const row of processedChain) {
      let loss = 0;
      for (const r2 of processedChain) {
        const ceLoss = Math.max(0, r2.strike - row.strike) * (r2.CE?.oi || 0);
        const peLoss = Math.max(0, row.strike - r2.strike) * (r2.PE?.oi || 0);
        loss += ceLoss + peLoss;
      }
      if (loss < minLoss) {
        minLoss = loss;
        maxPainStrike = row.strike;
      }
    }

    const chainData = {
      symbol,
      isEquity: !!opts.equity,
      underlyingLTP,
      expiryDates,
      chain: processedChain,
      totalCEOI,
      totalPEOI,
      pcr,
      maxPainStrike,
      timestamp,
    };

    optionChainCache.set(symbol, chainData);
    if (io) io.emit(`optionChain:${symbol}`, chainData);
  } catch (err) {
    console.error(`[Poller] Error polling option chain ${symbol}:`, err.message);
  }
}

/**
 * Poll a single equity symbol
 */
async function pollSymbol(symbol) {
  // Check if in backoff
  if (backoffTimers.has(symbol)) return;

  try {
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
    const response = await axios.get(url, {
      headers: getHeaders(),
      timeout: 6000,
      validateStatus: () => true,
    });

    if (isCookieDead(response)) {
      await refreshCookies();
      recordFailure(symbol);
      return;
    }

    const priceInfo = response.data?.priceInfo || {};
    const info = response.data?.info || {};
    const ts = response.data?.metadata?.lastUpdateTime;

    const tick = {
      symbol,
      ltp: parseFloat(priceInfo.lastPrice || 0),
      open: parseFloat(priceInfo.open || 0),
      high: parseFloat(priceInfo.intraDayHighLow?.max || priceInfo.weekHighLow?.max || 0),
      low: parseFloat(priceInfo.intraDayHighLow?.min || priceInfo.weekHighLow?.min || 0),
      volume: parseInt(response.data?.securityWiseDP?.quantityTraded || 0),
      oi: 0,
      iv: 0,
      timestamp: ts ? new Date(ts).getTime() : Date.now(),
    };

    if (tick.ltp > 0) {
      await storeTick(symbol, tick);
      emitTick(symbol, tick);
      recordSuccess(symbol);
    }
  } catch (err) {
    recordFailure(symbol);
    const failCount = failureCounts.get(symbol) || 0;

    if (failCount >= 5) {
      const delay = getBackoffDelay(symbol);
      console.warn(`[Poller] Circuit breaker for ${symbol}: ${failCount} failures, backing off ${delay}ms`);
      const timer = setTimeout(() => {
        backoffTimers.delete(symbol);
        failureCounts.set(symbol, Math.max(0, failCount - 1));
      }, delay);
      backoffTimers.set(symbol, timer);
    }
  }
}

/**
 * Daily Redis flush — only once per day
 */
async function runDailyFlush() {
  const today = dayjs().format('YYYY-MM-DD');
  const flagKey = 'lastFlushDate';
  const lastFlush = await redis.get(flagKey);

  if (lastFlush === today) {
    console.log('[Poller] Daily Redis flush already done today. Skipping.');
    return;
  }

  console.log('[Poller] Running daily Redis flush...');
  const keys = await redis.keys('ticks:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  await redis.set(flagKey, today);
  console.log(`[Poller] Flushed ${keys.length} tick keys.`);
}

/**
 * Main polling loop for index endpoints (every 1000ms, 150ms staggered)
 */
async function runIndexPolling() {
  const indexEndpoints = ['NIFTY 50', 'NIFTY 100', 'NIFTY 500', 'SECURITIES IN F&O'];
  const optionSymbols = ['NIFTY', 'BANKNIFTY', 'NIFTY MIDCAP SELECT'];

  let idx = 0;
  const allEndpoints = [...indexEndpoints, ...optionSymbols.map(s => `__OC__${s}`)];

  for (const endpoint of allEndpoints) {
    await sleep(150);
    if (endpoint.startsWith('__OC__')) {
      await pollOptionChain(endpoint.replace('__OC__', ''));
    } else {
      await pollEquityIndex(endpoint);
    }
    idx++;
  }
}

/**
 * Rotating poller for F&O *stock* option chains (RELIANCE, TCS, INFY, ...).
 * Index option chains (NIFTY/BANKNIFTY/NIFTY MIDCAP SELECT) refresh every
 * second via runIndexPolling above — that cadence isn't realistic for ~185
 * stock option chains, so instead we cycle through the F&O stock universe
 * one symbol at a time, refreshing each roughly every (interval * count)ms.
 * This is what lets a stock like RELIANCE show its own CE/PE chain instead
 * of always falling back to the NIFTY chain.
 */
let fnoChainCursor = 0;
async function pollNextEquityOptionChain(fnoSymbols) {
  if (!fnoSymbols || fnoSymbols.length === 0) return;
  const symbol = fnoSymbols[fnoChainCursor % fnoSymbols.length];
  fnoChainCursor++;
  await pollOptionChain(symbol, { equity: true });
}

/**
 * Rolling batch poller for full symbol universe
 * Each symbol refreshes every ~15-20 seconds
 */
async function startBatchPoller(symbols) {
  const BATCH_SIZE = 25;
  const BATCH_DELAY = 1000; // 1 second between batches → 25 symbols/sec

  let batchIdx = 0;
  let batchPoller = null;

  async function runBatch() {
    if (!isPolling) return;

    const start = batchIdx * BATCH_SIZE;
    const batch = symbols.slice(start, start + BATCH_SIZE);

    for (const symbol of batch) {
      if (!isPolling) break;
      await pollSymbol(symbol);
      await sleep(40); // ~25 polls per second within batch
    }

    batchIdx = (batchIdx + 1) % Math.ceil(symbols.length / BATCH_SIZE);

    if (isPolling) {
      batchPoller = setTimeout(runBatch, BATCH_DELAY);
    }
  }

  runBatch();
  return () => {
    if (batchPoller) clearTimeout(batchPoller);
  };
}

/**
 * Start the main polling loop
 */
async function startPolling(symbols) {
  isPolling = true;
  console.log('[Poller] Starting live data polling...');

  // Daily flush at market open
  await runDailyFlush();

  // Index polling every 1000ms
  const indexInterval = setInterval(async () => {
    if (!isPolling) return;
    try {
      await runIndexPolling();
    } catch (err) {
      console.error('[Poller] Index polling error:', err.message);
    }
  }, 1000);

  // F&O stock option-chain rotation — one stock's chain every 1.5s
  const fnoChainInterval = setInterval(async () => {
    if (!isPolling) return;
    try {
      await pollNextEquityOptionChain(FNO_SYMBOLS);
    } catch (err) {
      console.error('[Poller] F&O option chain rotation error:', err.message);
    }
  }, 1500);

  // Batch poller for full universe
  const stopBatch = await startBatchPoller(symbols);

  return () => {
    clearInterval(indexInterval);
    clearInterval(fnoChainInterval);
    stopBatch();
  };
}

function stopPolling() {
  isPolling = false;
  console.log('[Poller] Polling stopped at 15:31');
  if (pollerStopCallback) pollerStopCallback();
}

function getOptionChain(symbol) {
  return optionChainCache.get(symbol) || null;
}

function getCircuitBreakerSymbols() {
  return Array.from(backoffTimers.keys());
}

/**
 * Initialize polling schedule
 */
function initPollerSchedule(symbols) {
  // Start at 9:00:00 IST
  cron.schedule('0 9 * * *', async () => {
    const today = new Date();
    if (!isTradingDay(today)) {
      const holidayName = getTodayHolidayName();
      const reason = holidayName || 'Weekend';
      console.log(`[Poller] Not a trading day (${reason}). Polling will not start.`);
      if (io) io.emit('marketStatus', { open: false, reason });
      return;
    }

    console.log('[Poller] Market open. Starting polling at 9:00 IST...');
    if (io) io.emit('marketStatus', { open: true });
    const stopFn = await startPolling(symbols);

    // Stop at 15:31:00 IST
    cron.schedule('31 15 * * *', () => {
      stopFn();
      stopPolling();
    }, { once: true });

  }, { timezone: 'Asia/Kolkata' });

  // Stop at 15:31 IST (backup cron)
  cron.schedule('31 15 * * *', () => {
    if (isPolling) {
      stopPolling();
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[Poller] Scheduler initialized. Will start at 9:00 AM IST on trading days.');
}

module.exports = {
  init,
  initPollerSchedule,
  startPolling,
  stopPolling,
  getOptionChain,
  getCircuitBreakerSymbols,
  fetchSnapshotQuote,
};
