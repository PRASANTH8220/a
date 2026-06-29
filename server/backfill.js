/**
 * backfill.js — First-run and incremental historical data backfill from NSE
 */

const dayjs = require('dayjs');
const { getHeaders } = require('./cookie');
const { NIFTY500_SYMBOLS, FNO_SYMBOLS, INDICES } = require('./symbols');
const { Candle } = require('./candle');

let axios;
try {
  axios = require('axios');
} catch {
  axios = null;
}

let backfillStatus = {
  running: false,
  total: 0,
  done: 0,
  complete: false,
  error: null,
  startedAt: null,
};

function getStatus() {
  return { ...backfillStatus };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch daily OHLCV from NSE for equity symbol
 */
async function fetchEquityHistory(symbol, fromDate, toDate) {
  const url = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&series=EQ&from=${fromDate}&to=${toDate}`;
  const resp = await axios.get(url, {
    headers: getHeaders(),
    timeout: 15000,
  });

  const data = resp.data?.data || [];
  return data.map(row => ({
    symbol,
    timeframe: '1D',
    time: new Date(row.CH_TIMESTAMP || row.TIMESTAMP).setHours(0, 0, 0, 0),
    open: parseFloat(row.CH_OPENING_PRICE || row.open || 0),
    high: parseFloat(row.CH_TRADE_HIGH_PRICE || row.high || 0),
    low: parseFloat(row.CH_TRADE_LOW_PRICE || row.low || 0),
    close: parseFloat(row.CH_CLOSING_PRICE || row.close || 0),
    volume: parseInt(row.CH_TOT_TRADED_QTY || row.volume || 0),
    oi: 0,
    partial: false,
  })).filter(c => c.open > 0 && c.close > 0);
}

/**
 * Fetch daily OHLCV from NSE for index
 */
async function fetchIndexHistory(indexName, fromDate, toDate) {
  const url = `https://www.nseindia.com/api/historical/indicesHistory?indexType=${encodeURIComponent(indexName)}&from=${fromDate}&to=${toDate}`;
  const resp = await axios.get(url, {
    headers: getHeaders(),
    timeout: 15000,
  });

  const data = resp.data?.data?.indexCloseOnlineRecords || [];
  return data.map(row => ({
    symbol: indexName,
    timeframe: '1D',
    time: new Date(row.EOD_TIMESTAMP || row.TIMESTAMP).setHours(0, 0, 0, 0),
    open: parseFloat(row.EOD_OPEN_INDEX_VAL || 0),
    high: parseFloat(row.EOD_HIGH_INDEX_VAL || 0),
    low: parseFloat(row.EOD_LOW_INDEX_VAL || 0),
    close: parseFloat(row.EOD_CLOSE_INDEX_VAL || 0),
    volume: parseInt(row.EOD_TRADED_QTY || 0),
    oi: 0,
    partial: false,
  })).filter(c => c.open > 0 && c.close > 0);
}

/**
 * Fetch daily OHLCV from Yahoo Finance (no cookies needed — used as NSE fallback)
 * Yahoo symbol format: RELIANCE.NS, ^NSEI (Nifty), ^NSEBANK (BankNifty)
 */
const YAHOO_INDEX_MAP = {
  'NIFTY': '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'NIFTY MIDCAP SELECT': 'NIFTY_MID_SELECT.NS',
  'SENSEX': '^BSESN',
};

// Equity overrides for symbols that don't follow the simple SYMBOL.NS pattern
const YAHOO_EQUITY_OVERRIDES = {
  'M&M':        'M%26M.NS',
  'BAJAJ-AUTO': 'BAJAJ-AUTO.NS',
  'JIOFIN':     'JIOFIN.NS',
  'LICI':       'LICI.NS',
  'MAXLIFE':    'MAXLIFE.NS',
  'NAUKRI':     'NAUKRI.NS',
  'PNBHOUSING': 'PNBHOUSING.NS',
  'SONACOMS':   'SONACOMS.NS',
};

function toYahooSym(symbol) {
  if (YAHOO_INDEX_MAP[symbol]) return YAHOO_INDEX_MAP[symbol];
  if (YAHOO_EQUITY_OVERRIDES[symbol]) return YAHOO_EQUITY_OVERRIDES[symbol];
  return `${symbol}.NS`;
}

async function fetchYahooHistory(symbol, fromDate, toDate) {
  // Convert DD-MM-YYYY to unix timestamps
  const parseDate = (d) => {
    const [dd, mm, yyyy] = d.split('-');
    return Math.floor(new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`).getTime() / 1000);
  };
  const period1 = parseDate(fromDate);
  const period2 = parseDate(toDate) + 86400; // include toDate

  const yahooSym = toYahooSym(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&period1=${period1}&period2=${period2}&events=history`;

  const resp = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
    timeout: 15000,
  });

  const result = resp.data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const closes = q.close || [];
  const volumes = q.volume || [];

  return timestamps.map((ts, i) => ({
    symbol,
    timeframe: '1D',
    time: new Date(ts * 1000).setHours(0, 0, 0, 0),
    open: parseFloat((opens[i] || 0).toFixed(2)),
    high: parseFloat((highs[i] || 0).toFixed(2)),
    low: parseFloat((lows[i] || 0).toFixed(2)),
    close: parseFloat((closes[i] || 0).toFixed(2)),
    volume: parseInt(volumes[i] || 0),
    oi: 0,
    partial: false,
  })).filter(c => c.open > 0 && c.close > 0);
}

/**
 * Save candles, skipping duplicates
 */
async function saveCandles(candles) {
  if (!candles.length) return 0;
  let saved = 0;
  for (const c of candles) {
    try {
      await Candle.findOneAndUpdate(
        { symbol: c.symbol, timeframe: c.timeframe, time: c.time },
        c,
        { upsert: true }
      );
      saved++;
    } catch (err) {
      if (!err.message?.includes('duplicate key')) {
        // ignore duplicates silently
      }
    }
  }
  return saved;
}

/**
 * Find last saved date for a symbol
 */
async function getLastSavedDate(symbol) {
  const last = await Candle.findOne({ symbol, timeframe: '1D' }).sort({ time: -1 }).lean();
  return last ? new Date(last.time) : null;
}

/**
 * Run the backfill job
 * @param {boolean} force - Force full backfill even if data exists
 */
async function runBackfill(force = false) {
  if (backfillStatus.running) {
    console.log('[Backfill] Already running, skipping...');
    return;
  }

  // Deduplicate symbols
  const allSymbols = [...new Set([...NIFTY500_SYMBOLS, ...FNO_SYMBOLS])];
  const allEntities = [...allSymbols, ...INDICES];

  backfillStatus = {
    running: true,
    total: allEntities.length,
    done: 0,
    complete: false,
    error: null,
    startedAt: new Date().toISOString(),
  };

  const toDateStr = dayjs().format('DD-MM-YYYY');
  let totalSaved = 0;

  console.log(`[Backfill] Starting for ${allEntities.length} symbols...`);

  for (let i = 0; i < allSymbols.length; i++) {
    const symbol = allSymbols[i];

    try {
      // Determine date range
      const lastDate = force ? null : await getLastSavedDate(symbol);
      const fromDate = lastDate
        ? dayjs(lastDate).add(1, 'day').format('DD-MM-YYYY')
        : dayjs().subtract(730, 'day').format('DD-MM-YYYY');

      // Skip if up to date
      if (lastDate && dayjs(lastDate).isSame(dayjs(), 'day')) {
        backfillStatus.done++;
        continue;
      }

      let candles = [];
      try {
        candles = await fetchEquityHistory(symbol, fromDate, toDateStr);
      } catch (nseErr) {
        console.warn(`[Backfill] NSE failed for ${symbol} (${nseErr.message}), trying Yahoo...`);
        try {
          candles = await fetchYahooHistory(symbol, fromDate, toDateStr);
        } catch (yahooErr) {
          console.error(`[Backfill] Yahoo also failed for ${symbol}: ${yahooErr.message}`);
        }
      }
      const saved = await saveCandles(candles);
      totalSaved += saved;

      backfillStatus.done++;
      console.log(`[Backfill] ${symbol} — ${saved} candles saved (${backfillStatus.done}/${backfillStatus.total})`);
    } catch (err) {
      console.error(`[Backfill] Error for ${symbol}: ${err.message}`);
      backfillStatus.done++;
    }

    // Rate limit: 100ms between requests
    await sleep(100);
  }

  // Backfill indices
  const indexNameMap = {
    'NIFTY': 'NIFTY 50',
    'BANKNIFTY': 'NIFTY BANK',
    'NIFTY MIDCAP SELECT': 'NIFTY MIDCAP SELECT',
    'SENSEX': 'SENSEX',
  };

  for (const idxSymbol of INDICES) {
    try {
      const lastDate = force ? null : await getLastSavedDate(idxSymbol);
      const fromDate = lastDate
        ? dayjs(lastDate).add(1, 'day').format('DD-MM-YYYY')
        : dayjs().subtract(730, 'day').format('DD-MM-YYYY');

      if (lastDate && dayjs(lastDate).isSame(dayjs(), 'day')) {
        backfillStatus.done++;
        continue;
      }

      const indexType = indexNameMap[idxSymbol] || idxSymbol;
      let candles = [];
      try {
        candles = await fetchIndexHistory(indexType, fromDate, toDateStr);
      } catch (nseErr) {
        console.warn(`[Backfill] NSE failed for index ${idxSymbol} (${nseErr.message}), trying Yahoo...`);
        try {
          candles = await fetchYahooHistory(idxSymbol, fromDate, toDateStr);
        } catch (yahooErr) {
          console.error(`[Backfill] Yahoo also failed for index ${idxSymbol}: ${yahooErr.message}`);
        }
      }
      const saved = await saveCandles(candles);
      totalSaved += saved;
      backfillStatus.done++;
      console.log(`[Backfill] Index ${idxSymbol} — ${saved} candles saved`);
    } catch (err) {
      console.error(`[Backfill] Error for index ${idxSymbol}: ${err.message}`);
      backfillStatus.done++;
    }
    await sleep(500);
  }

  backfillStatus.running = false;
  backfillStatus.complete = true;
  console.log(`[Backfill] Complete. ${totalSaved} total candles saved.`);
}

/**
 * Check if backfill is needed and start in background
 */
async function checkAndRunBackfill() {
  // Check if 1D data exists and is recent
  const lastCandle = await Candle.findOne({ timeframe: '1D' }).sort({ time: -1 }).lean();
  const yesterday = dayjs().subtract(1, 'day').startOf('day').valueOf();

  if (!lastCandle || lastCandle.time < yesterday) {
    console.log('[Backfill] Data missing or stale. Starting backfill in background...');
    // Run asynchronously — don't block server startup
    setImmediate(() => runBackfill(false).catch(err => {
      backfillStatus.error = err.message;
      backfillStatus.running = false;
      console.error('[Backfill] Fatal error:', err.message);
    }));
  } else {
    console.log('[Backfill] Data is up to date. Skipping.');
    backfillStatus.complete = true;
  }
}

module.exports = { checkAndRunBackfill, runBackfill, getStatus };