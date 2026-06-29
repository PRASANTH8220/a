/**
 * index.js — NexTrade Server: Express + Socket.IO entry point
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cron = require('node-cron');

const { initCookies } = require('./cookie');
const { initPollerSchedule, getOptionChain, getCircuitBreakerSymbols } = require('./poller');
const { init: initCandle, runCandleBuilder, buildDailyCandles, preloadCandleCache, getCandles, notifyPollerStopped } = require('./candle');
const { startScanner, getLatestResults, getLatestTick } = require('./scanner');
const { checkAndRunBackfill, getStatus: getBackfillStatus } = require('./backfill');
const { NIFTY50_SYMBOLS, NIFTY100_SYMBOLS, NIFTY500_SYMBOLS, FNO_SYMBOLS, INDICES } = require('./symbols');
const paper = require('./paperTrading');

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
    const candles = await getCandles(symbol, timeframe, limit, before);
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

// Latest tick for a symbol
app.get('/api/quote/:symbol', (req, res) => {
  const tick = getLatestTick(req.params.symbol.toUpperCase());
  if (!tick) return res.status(404).json({ error: 'No tick data available' });
  res.json(tick);
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

app.post('/api/paper/order', async (req, res) => {
  try {
    const tick = getLatestTick(req.body.symbol);
    const currentLTP = tick?.ltp || req.body.limitPrice || 0;
    res.json(await paper.placeOrder({ ...req.body, currentLTP }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paper/close', async (req, res) => {
  try {
    const { tradeId } = req.body;
    const trade = await paper.getPositions();
    const pos = trade.find(t => t._id.toString() === tradeId);
    const tick = pos ? getLatestTick(pos.symbol) : null;
    const exitPrice = tick?.ltp || req.body.exitPrice || 0;
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

  // Initialize NSE cookies
  await initCookies();

  // Initialize modules
  const allSymbols = [...new Set([...NIFTY500_SYMBOLS, ...FNO_SYMBOLS, ...INDICES])];
  initCandle(redis, io);

  // Preload candle cache
  await preloadCandleCache(NIFTY50_SYMBOLS); // preload top 50 on startup

  // Initialize scanner
  startScanner(io);

  // Initialize poller with stop callback for 1D aggregation
  const { init: initPoller } = require('./poller');
  initPoller(redis, io, () => {
    notifyPollerStopped();
    // 1D aggregation after 15:31
    setTimeout(() => buildDailyCandles(allSymbols), 5000);
  });

  // Schedule polling (starts at 9:00 AM on trading days)
  initPollerSchedule(allSymbols);

  // Candle builder: run every 60 seconds
  setInterval(() => {
    runCandleBuilder(allSymbols).catch(err =>
      console.error('[CandleBuilder] Error:', err.message)
    );
  }, 60000);

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
