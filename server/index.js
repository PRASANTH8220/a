/**
 * index.js — NexTrade Server: Express + Socket.IO entry point
 */

require('dotenv').config();

// ─── AngelOne SmartAPI Credentials ─────────────────────────────────────────
// Loaded from .env — used by any module that integrates AngelOne SmartAPI.
// Existing NSE polling logic is UNCHANGED; these are additive credentials only.
const ANGEL_CONFIG = {
  apiKey:      process.env.ANGEL_API_KEY      || '',
  totpSecret:  process.env.ANGEL_TOTP_SECRET  || '',
  staticIp:    process.env.ANGEL_STATIC_IP    || '',
  clientId:    process.env.ANGEL_CLIENT_ID    || '',
  password:    process.env.ANGEL_PASSWORD     || '',
  mpin:        process.env.ANGEL_MPIN         || '',
};
module.exports.ANGEL_CONFIG = ANGEL_CONFIG;
// ────────────────────────────────────────────────────────────────────────────

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cron = require('node-cron');

const { initCookies } = require('./cookie');
const { initPollerSchedule, getOptionChain, getCircuitBreakerSymbols, fetchSnapshotQuote } = require('./poller');
const { init: initCandle, runCandleBuilder, buildDailyCandles, preloadCandleCache, getCandles, notifyPollerStopped, purgeIntradayCandles, pruneDailyCandles } = require('./candle');
const { startScanner, getLatestResults, getLatestTick } = require('./scanner');
const { checkAndRunBackfill, getStatus: getBackfillStatus, runBackfillForSymbol } = require('./backfill');
const { NIFTY50_SYMBOLS, NIFTY100_SYMBOLS, NIFTY500_SYMBOLS, FNO_SYMBOLS, INDICES } = require('./symbols');
const paper = require('./paperTrading');
const { fetchFromNSE, fetchYahooIntradayForDate } = require('./historicalFeed');

// ─── Express & Socket.IO Setup ─────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

// ─── Redis ─────────────────────────────────────────────────────────────────
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

// ─── MongoDB ────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nextrade';
mongoose.connect(MONGO_URI)
  .then(() => console.log('[MongoDB] Connected'))
  .catch(err => console.error('[MongoDB] Connection error:', err.message));

// ─── Socket.IO ──────────────────────────────────────────────────────────────
let connectedClients = 0;

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`[Socket.IO] Client connected: ${socket.id} (total: ${connectedClients})`);

  socket.on('subscribe', (symbol) => {
    socket.join(symbol);
  });

  socket.on('unsubscribe', (symbol) => {
    socket.leave(symbol);
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// ─── REST API ───────────────────────────────────────────────────────────────

// Historical candles with pagination
app.get('/api/candles/:symbol/:timeframe', async (req, res) => {
  try {
    const { symbol, timeframe } = req.params;
    const limit = parseInt(req.query.limit) || 200;
    const before = req.query.before || null;
    const INTRADAY = ['1min', '5min', '15min', '1hr'];

    let candles = await getCandles(symbol, timeframe, limit, before);

    // For intraday timeframes, only serve candles from today (IST).
    // Stale candles from previous sessions are useless — always fetch live.
    if (INTRADAY.includes(timeframe) && candles.length) {
      const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      todayIST.setHours(0, 0, 0, 0);
      const todayMs = todayIST.getTime();
      candles = candles.filter(c => c.time >= todayMs);
    }

    // Fallback: DB empty / intraday has no today data -> fetch live from NSE/Yahoo
    if (!candles.length && !before) {
      console.log(`[Candles] DB empty for ${symbol}/${timeframe}, fetching live...`);
      try { candles = await fetchFromNSE(symbol, timeframe, limit); }
      catch (tvErr) { console.error('[Candles] Live fallback failed:', tvErr.message); }
    }

    res.json({ candles, serverStartDate: process.env.SERVER_START_DATE || new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Latest option chain from cache
app.get('/api/option-chain/:symbol', (req, res) => {
  const chain = getOptionChain(req.params.symbol.toUpperCase());
  if (!chain) return res.status(404).json({ error: 'Option chain not available yet' });
  res.json(chain);
});

// Scanner results
app.get('/api/scanner', (req, res) => {
  res.json(getLatestResults());
});

// All symbol lists
app.get('/api/symbols', (req, res) => {
  res.json({
    nifty50: NIFTY50_SYMBOLS,
    nifty100: NIFTY100_SYMBOLS,
    nifty500: NIFTY500_SYMBOLS,
    fno: FNO_SYMBOLS,
    indices: INDICES,
  });
});

// Latest tick for a symbol — falls back to an on-demand NSE snapshot, then
// the last stored daily close, so LTP is still available when the market
// is closed (after 15:31 IST, weekends, holidays, or right after a fresh
// server start before the poller has produced a tick yet).
app.get('/api/quote/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  // 1) Live in-memory tick from the poller (market open)
  const liveTick = getLatestTick(symbol);
  if (liveTick) return res.json({ ...liveTick, source: 'live' });

  // 2) On-demand snapshot straight from NSE. NSE's quote APIs keep
  //    returning the last traded price after hours, so this works even
  //    when the scheduled poller isn't running.
  try {
    const snapshot = await fetchSnapshotQuote(symbol);
    if (snapshot && snapshot.ltp > 0) {
      return res.json({ ...snapshot, source: 'nse_snapshot' });
    }
  } catch (err) {
    console.error(`[API] Snapshot fetch failed for ${symbol}:`, err.message);
  }

  // 3) Last stored daily candle close — works fully offline (no NSE call),
  //    covers symbols NSE's live quote API won't return cleanly (e.g. when
  //    cookies are mid-refresh).
  try {
    const candles = await getCandles(symbol, '1D', 1);
    if (candles.length) {
      const c = candles[candles.length - 1];
      return res.json({
        symbol,
        ltp: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
        volume: c.volume,
        oi: c.oi || 0,
        timestamp: c.time,
        source: 'last_close',
      });
    }
  } catch (err) {
    console.error(`[API] Last-close fallback failed for ${symbol}:`, err.message);
  }

  res.status(404).json({ error: 'No tick data available' });
});

// Drill-down: intraday candles for a specific past date (History Mode).
// Called when user clicks a candle on the 1D chart to drill into that day.
// date param: YYYY-MM-DD   timeframe: 5min | 15min | 1hr
// For today → serves live candles. For past days → fetches from Yahoo.
app.get('/api/drilldown/:symbol/:timeframe', async (req, res) => {
  try {
    const { symbol, timeframe } = req.params;
    const date = req.query.date; // YYYY-MM-DD
    if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

    const sym = symbol.toUpperCase();
    const INTRADAY = ['1min', '5min', '15min', '1hr'];
    if (!INTRADAY.includes(timeframe)) {
      return res.status(400).json({ error: 'timeframe must be one of: 1min, 5min, 15min, 1hr' });
    }

    // Check if requested date is today (IST)
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayStr = `${nowIST.getFullYear()}-${String(nowIST.getMonth()+1).padStart(2,'0')}-${String(nowIST.getDate()).padStart(2,'0')}`;

    if (date === todayStr) {
      // Today → serve from live MongoDB/Redis candles
      let candles = await getCandles(sym, timeframe, 400);
      const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      todayIST.setHours(0, 0, 0, 0);
      candles = candles.filter(c => c.time >= todayIST.getTime());
      if (!candles.length) {
        try { candles = await fetchFromNSE(sym, timeframe, 400); } catch {}
      }
      return res.json({ symbol: sym, timeframe, date, candles, isToday: true });
    }

    // Past date → fetch from Yahoo for that exact session
    console.log(`[Drilldown] ${sym} ${timeframe} for ${date}`);
    const candles = await fetchYahooIntradayForDate(sym, date, timeframe);
    res.json({ symbol: sym, timeframe, date, candles, isToday: false });
  } catch (err) {
    console.error('[Drilldown] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// On-demand historical data: fetches 5 months of 1D candles for a symbol
// and caches them in MongoDB. Called when user first clicks a stock.
// Subsequent calls return from cache (no re-fetch within 1 trading day).
app.get('/api/history/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const candles = await runBackfillForSymbol(symbol);
    res.json({ symbol, candles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backfill status
app.get('/api/backfill/status', (req, res) => {
  res.json(getBackfillStatus());
});

// Server status (for StatusBar)
app.get('/api/status', (req, res) => {
  res.json({
    connected: true,
    redisOk: redis.status === 'ready',
    mongoOk: mongoose.connection.readyState === 1,
    circuitBreakerSymbols: getCircuitBreakerSymbols(),
    backfill: getBackfillStatus(),
    connectedClients,
    serverTime: new Date().toISOString(),
  });
});

// ─── Paper Trading API ───────────────────────────────────────────────────────

app.get('/api/paper/account', async (req, res) => {
  try { res.json(await paper.getAccount()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paper/topup', async (req, res) => {
  try {
    const { amount } = req.body;
    res.json(await paper.topUp({ amount: parseFloat(amount) }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paper/reset', async (req, res) => {
  try { res.json(await paper.resetAccount()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Shared helper: best-available LTP for the underlying (live -> NSE snapshot -> last close)
async function resolveLTP(symbol) {
  const sym = symbol.toUpperCase();
  const liveTick = getLatestTick(sym);
  if (liveTick?.ltp) return liveTick.ltp;
  try {
    const snapshot = await fetchSnapshotQuote(sym);
    if (snapshot?.ltp) return snapshot.ltp;
  } catch (err) {
    console.error(`[API] resolveLTP snapshot failed for ${sym}:`, err.message);
  }
  try {
    const candles = await getCandles(sym, '1D', 1);
    if (candles.length) return candles[candles.length - 1].close;
  } catch (err) {
    console.error(`[API] resolveLTP last-close failed for ${sym}:`, err.message);
  }
  return 0;
}

// Best-available execution price for an order: for CE/PE option orders this
// is the strike's own premium from the cached option chain (NOT the
// underlying's equity price); for plain EQ orders it's the underlying LTP.
async function resolveOrderPrice({ symbol, optionType, strike, expiry }) {
  const sym = (symbol || '').toUpperCase();
  const isOption = optionType === 'CE' || optionType === 'PE';
  if (isOption) {
    const chain = getOptionChain(sym);
    const row = chain?.chain?.find(r => r.strike === strike && (!expiry || r.expiry === expiry));
    const leg = row ? row[optionType] : null;
    return leg?.ltp || 0;
  }
  return resolveLTP(sym);
}

app.post('/api/paper/order', async (req, res) => {
  try {
    const resolved = await resolveOrderPrice(req.body);
    const currentLTP = resolved || req.body.limitPrice || 0;
    res.json(await paper.placeOrder({ ...req.body, currentLTP }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paper/close', async (req, res) => {
  try {
    const { tradeId } = req.body;
    const positions = await paper.getPositions();
    const pos = positions.find(t => t._id.toString() === tradeId);
    let exitPrice = req.body.exitPrice || 0;
    if (pos) {
      const resolved = await resolveOrderPrice(pos);
      exitPrice = resolved || exitPrice;
    }
    res.json(await paper.closePosition({ tradeId, exitPrice }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/paper/trades', async (req, res) => {
  try { res.json(await paper.getTradeHistory()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/paper/positions', async (req, res) => {
  try { res.json(await paper.getPositions()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/paper/orders', async (req, res) => {
  try { res.json(await paper.getPendingOrders()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/paper/analytics', async (req, res) => {
  try { res.json(await paper.getAnalytics()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Initialization ──────────────────────────────────────────────────────────

async function bootstrap() {
  // Record server start date
  process.env.SERVER_START_DATE = new Date().toISOString();

  // Initialize NSE cookies — still needed for option-chain REST calls
  await initCookies();

  const allSymbols = [...new Set([...NIFTY500_SYMBOLS, ...FNO_SYMBOLS, ...INDICES])];
  initCandle(redis, io);

  // Preload candle cache
  await preloadCandleCache(NIFTY50_SYMBOLS);

  // Initialize scanner
  startScanner(io);

  // ── Live Feed: AngelOne SmartAPI (primary) → NSE poller (fallback) ────────
  const { initAngelOneFeed, stopFeed: stopAngelFeed } = require('./angelone');
  const angelOk = await initAngelOneFeed(allSymbols, redis, io);

  if (!angelOk) {
    // Fallback: NSE cookie poller (used when AngelOne creds not yet set)
    console.log('[Bootstrap] Using NSE cookie poller as fallback.');
    const { init: initPoller } = require('./poller');
    initPoller(redis, io, () => {
      notifyPollerStopped();
      setTimeout(() => buildDailyCandles(allSymbols), 5000);
    });
    initPollerSchedule(allSymbols);
  } else {
    // AngelOne is live — handle 15:31 EOD aggregation via cron
    cron.schedule('31 15 * * 1-5', () => {
      stopAngelFeed();
      notifyPollerStopped();
      setTimeout(() => buildDailyCandles(allSymbols), 5000);
    }, { timezone: 'Asia/Kolkata' });
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Candle builder: run every 60 seconds
  setInterval(() => {
    runCandleBuilder(allSymbols).catch(err =>
      console.error('[CandleBuilder] Error:', err.message)
    );
  }, 60000);

  // ── EOD Market Close Jobs (IST) ─────────────────────────────────────────────
  // 15:25 IST — Square off all open MIS positions before exchange forcefully closes them
  cron.schedule('25 15 * * 1-5', async () => {
    console.log('[EOD] 15:25 IST — Auto square-off of open MIS positions...');
    try {
      const result = await paper.squareOffAllMIS(resolveLTP);
      io.emit('eodSquareOff', {
        message: `Market closing: ${result.squaredOff} MIS position(s) squared off`,
        squaredOff: result.squaredOff,
        totalPnL: result.totalPnL,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[EOD] Square-off failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 15:35 IST — After 1D candles are built, purge intraday candles from MongoDB
  // Redis ticks have their own 86400s TTL set in poller, so we only clean Mongo here.
  cron.schedule('35 15 * * 1-5', async () => {
    console.log('[EOD] 15:35 IST — Purging intraday candles from MongoDB...');
    try {
      await purgeIntradayCandles();
      // Prune daily candles to keep only last 150 per symbol (prevent growth over time)
      const allSymbols = [...new Set([...NIFTY500_SYMBOLS, ...FNO_SYMBOLS, ...INDICES])];
      await pruneDailyCandles(allSymbols);
    } catch (err) {
      console.error('[EOD] Intraday purge failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Reset dayPnL at midnight every day
  cron.schedule('0 0 * * *', async () => {
    try {
      const mongoose = require('mongoose');
      const Account = mongoose.model('PaperAccount');
      await Account.updateMany({}, { $set: { dayPnL: 0 } });
      console.log('[EOD] dayPnL reset for all accounts');
    } catch (err) {
      console.error('[EOD] dayPnL reset failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Check and run backfill (background, non-blocking)
  setTimeout(() => checkAndRunBackfill(), 5000);

  // Emit periodic status
  setInterval(() => {
    io.emit('serverStatus', {
      backfill: getBackfillStatus(),
      circuitBreakerSymbols: getCircuitBreakerSymbols(),
      serverTime: new Date().toISOString(),
    });
  }, 5000);

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  NexTrade Server running on :${PORT}   ║`);
    console.log(`║  Redis: ${redis.status.padEnd(27)}║`);
    console.log(`║  MongoDB: connecting...              ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
  });
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});

module.exports = { app, io };