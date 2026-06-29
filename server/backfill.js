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
        : dayjs().subtract(365, 'day').format('DD-MM-YYYY');

      // Skip if up to date
      if (lastDate && dayjs(lastDate).isSame(dayjs(), 'day')) {
        backfillStatus.done++;
        continue;
      }

      const candles = await fetchEquityHistory(symbol, fromDate, toDateStr);
      const saved = await saveCandles(candles);
      totalSaved += saved;

      backfillStatus.done++;
      console.log(`[Backfill] ${symbol} — ${saved} candles saved (${backfillStatus.done}/${backfillStatus.total})`);
    } catch (err) {
      console.error(`[Backfill] Error for ${symbol}: ${err.message}`);
      backfillStatus.done++;
    }

    // Rate limit: 500ms between requests
    await sleep(500);
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
        : dayjs().subtract(365, 'day').format('DD-MM-YYYY');

      if (lastDate && dayjs(lastDate).isSame(dayjs(), 'day')) {
        backfillStatus.done++;
        continue;
      }

      const indexType = indexNameMap[idxSymbol] || idxSymbol;
      const candles = await fetchIndexHistory(indexType, fromDate, toDateStr);
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
