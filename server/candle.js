/**
 * candle.js — OHLCV candle builder from Redis tick data
 */

const mongoose = require('mongoose');
const { computeAllIndicators } = require('./indicators');

// Candle schema
const CandleSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  timeframe: { type: String, required: true, index: true },
  time: { type: Number, required: true, index: true },
  open: Number,
  high: Number,
  low: Number,
  close: Number,
  volume: Number,
  oi: Number,
  partial: { type: Boolean, default: false },
}, { timestamps: true });

CandleSchema.index({ symbol: 1, timeframe: 1, time: 1 }, { unique: true });

let Candle;
try {
  Candle = mongoose.model('Candle');
} catch {
  Candle = mongoose.model('Candle', CandleSchema);
}

// In-memory candle cache: { [symbol_timeframe]: Candle[] }
const candleCache = {};

const TIMEFRAMES = {
  '1min': 60,
  '5min': 300,
  '15min': 900,
  '1hr': 3600,
};

let redis = null;
let io = null;
let pollerStopped = false;

function init(redisClient, socketIO) {
  redis = redisClient;
  io = socketIO;
}

function notifyPollerStopped() {
  pollerStopped = true;
}

/**
 * Build candles for a given timeframe window
 */
async function buildCandle(symbol, timeframe, windowStart, windowEnd) {
  const key = `ticks:${symbol}`;
  const ticks = await redis.zrangebyscore(key, windowStart, windowEnd);

  if (!ticks || ticks.length === 0) return null;

  const parsed = ticks.map(t => {
    try { return JSON.parse(t); } catch { return null; }
  }).filter(Boolean);

  if (parsed.length === 0) return null;

  const open = parsed[0].ltp;
  const close = parsed[parsed.length - 1].ltp;
  const high = Math.max(...parsed.map(t => t.ltp));
  const low = Math.min(...parsed.map(t => t.ltp));
  const firstVol = parsed[0].volume || 0;
  const lastVol = parsed[parsed.length - 1].volume || 0;
  const volume = Math.max(0, lastVol - firstVol);
  const oi = parsed[parsed.length - 1].oi || 0;
  const partial = parsed.length < 5;

  return {
    symbol,
    timeframe,
    time: windowStart,
    open: parseFloat(open.toFixed(2)),
    high: parseFloat(high.toFixed(2)),
    low: parseFloat(low.toFixed(2)),
    close: parseFloat(close.toFixed(2)),
    volume,
    oi,
    partial,
  };
}

/**
 * Save candle to MongoDB and update cache
 */
async function saveCandle(candle) {
  try {
    await Candle.findOneAndUpdate(
      { symbol: candle.symbol, timeframe: candle.timeframe, time: candle.time },
      candle,
      { upsert: true, new: true }
    );

    // Update in-memory cache
    const cacheKey = `${candle.symbol}_${candle.timeframe}`;
    if (!candleCache[cacheKey]) candleCache[cacheKey] = [];
    const idx = candleCache[cacheKey].findIndex(c => c.time === candle.time);
    if (idx >= 0) candleCache[cacheKey][idx] = candle;
    else {
      candleCache[cacheKey].push(candle);
      if (candleCache[cacheKey].length > 500) candleCache[cacheKey].shift();
    }

    // Emit via Socket.IO
    if (io) {
      const cacheForTf = candleCache[cacheKey];
      const indicators = computeAllIndicators(cacheForTf);
      io.emit('candle', { symbol: candle.symbol, timeframe: candle.timeframe, candle, indicators });
    }
  } catch (err) {
    if (!err.message?.includes('duplicate key')) {
      console.error(`[Candle] Save error for ${candle.symbol}:`, err.message);
    }
  }
}

/**
 * Run candle builder for all symbols across all timeframes
 */
async function runCandleBuilder(symbols) {
  const now = Math.floor(Date.now() / 1000);

  for (const tf of Object.keys(TIMEFRAMES)) {
    const seconds = TIMEFRAMES[tf];
    const windowEnd = Math.floor(now / seconds) * seconds - 1;
    const windowStart = windowEnd - seconds + 1;

    for (const symbol of symbols) {
      try {
        const candle = await buildCandle(symbol, tf, windowStart * 1000, windowEnd * 1000);
        if (candle) await saveCandle(candle);
      } catch (err) {
        console.error(`[Candle] Error building ${tf} candle for ${symbol}:`, err.message);
      }
    }
  }
}

/**
 * Aggregate 1D candles from 1min candles (called after 15:31 market close)
 */
async function buildDailyCandles(symbols) {
  if (!pollerStopped) {
    console.log('[Candle] Waiting for poller stop confirmation before 1D aggregation...');
    return;
  }

  const today = new Date();
  today.setHours(9, 15, 0, 0);
  const dayStart = Math.floor(today.getTime() / 1000);
  const dayEnd = Math.floor(Date.now() / 1000);

  for (const symbol of symbols) {
    try {
      const oneMinCandles = await Candle.find({
        symbol,
        timeframe: '1min',
        time: { $gte: dayStart * 1000, $lte: dayEnd * 1000 },
      }).sort({ time: 1 });

      if (oneMinCandles.length === 0) continue;

      const dateTs = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const dayCandle = {
        symbol,
        timeframe: '1D',
        time: dateTs * 1000,
        open: oneMinCandles[0].open,
        high: Math.max(...oneMinCandles.map(c => c.high)),
        low: Math.min(...oneMinCandles.map(c => c.low)),
        close: oneMinCandles[oneMinCandles.length - 1].close,
        volume: oneMinCandles.reduce((sum, c) => sum + (c.volume || 0), 0),
        oi: oneMinCandles[oneMinCandles.length - 1].oi || 0,
        partial: false,
      };

      await saveCandle(dayCandle);
    } catch (err) {
      console.error(`[Candle] Error building 1D candle for ${symbol}:`, err.message);
    }
  }
  console.log('[Candle] 1D candle aggregation complete');
}

/**
 * Preload last 200 candles from MongoDB into memory cache
 */
async function preloadCandleCache(symbols) {
  const timeframes = ['1min', '5min', '15min', '1hr', '1D'];
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      try {
        const candles = await Candle.find({ symbol, timeframe: tf })
          .sort({ time: -1 })
          .limit(200)
          .lean();
        const cacheKey = `${symbol}_${tf}`;
        candleCache[cacheKey] = candles.reverse();
      } catch (err) {
        // ignore
      }
    }
  }
  console.log('[Candle] Cache preloaded');
}

/**
 * Get candles from cache or DB
 */
async function getCandles(symbol, timeframe, limit = 200, before = null) {
  const query = { symbol, timeframe };
  if (before) query.time = { $lt: parseInt(before) };

  return await Candle.find(query)
    .sort({ time: -1 })
    .limit(limit)
    .lean()
    .then(candles => candles.reverse());
}

module.exports = {
  init,
  runCandleBuilder,
  buildDailyCandles,
  preloadCandleCache,
  getCandles,
  notifyPollerStopped,
  Candle,
};
