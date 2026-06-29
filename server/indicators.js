/**
 * indicators.js — Technical indicators computed as pure functions on candle arrays
 */

/**
 * EMA — Exponential Moving Average
 * @param {number[]} closes - Array of close prices
 * @param {number} period
 * @returns {number[]}
 */
function calculateEMA(closes, period) {
  if (closes.length < period) return closes.map(() => null);
  const k = 2 / (period + 1);
  const result = new Array(closes.length).fill(null);

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;

  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * SMA — Simple Moving Average
 */
function calculateSMA(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    result[i] = sum / period;
  }
  return result;
}

/**
 * RSI — Relative Strength Index (Wilder's smoothing)
 * @param {number[]} closes
 * @param {number} period (default 14)
 * @returns {number[]}
 */
function calculateRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result.map(v => v !== null ? parseFloat(v.toFixed(2)) : null);
}

/**
 * MACD — Moving Average Convergence Divergence
 * @param {number[]} closes
 * @param {number} fast (default 12)
 * @param {number} slow (default 26)
 * @param {number} signal (default 9)
 * @returns {{ macd: number[], signal: number[], histogram: number[] }}
 */
function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );

  const validMacd = macdLine.filter(v => v !== null);
  const emaSignalArr = calculateEMA(validMacd, signal);

  let sigIdx = 0;
  const signalLine = macdLine.map(v => {
    if (v === null) return null;
    return emaSignalArr[sigIdx++] ?? null;
  });

  const histogram = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null ? v - signalLine[i] : null
  );

  return {
    macd: macdLine.map(v => v !== null ? parseFloat(v.toFixed(4)) : null),
    signal: signalLine.map(v => v !== null ? parseFloat(v.toFixed(4)) : null),
    histogram: histogram.map(v => v !== null ? parseFloat(v.toFixed(4)) : null),
  };
}

/**
 * Bollinger Bands
 * @param {number[]} closes
 * @param {number} period (default 20)
 * @param {number} stdDev (default 2)
 * @returns {{ upper: number[], middle: number[], lower: number[] }}
 */
function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  const middle = calculateSMA(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = parseFloat((mean + stdDev * sd).toFixed(2));
    lower[i] = parseFloat((mean - stdDev * sd).toFixed(2));
  }

  return {
    upper,
    middle: middle.map(v => v !== null ? parseFloat(v.toFixed(2)) : null),
    lower,
  };
}

/**
 * VWAP — Volume Weighted Average Price
 * Resets at 9:15 AM IST each day
 * @param {Array} candles - Array of { time, high, low, close, volume }
 * @returns {number[]}
 */
function calculateVWAP(candles) {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let lastDate = null;

  return candles.map(candle => {
    const d = new Date(candle.time * 1000);
    const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    // Reset at new trading day
    if (dateKey !== lastDate) {
      cumulativeTPV = 0;
      cumulativeVolume = 0;
      lastDate = dateKey;
    }

    const tp = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += tp * (candle.volume || 0);
    cumulativeVolume += candle.volume || 0;

    if (cumulativeVolume === 0) return null;
    return parseFloat((cumulativeTPV / cumulativeVolume).toFixed(2));
  });
}

/**
 * ATR — Average True Range (Wilder's)
 * @param {Array} candles - Array of { high, low, close }
 * @param {number} period
 * @returns {number[]}
 */
function calculateATR(candles, period = 14) {
  const result = new Array(candles.length).fill(null);
  if (candles.length < 2) return result;

  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });

  // Initial ATR = SMA of first `period` TRs
  if (trueRanges.length < period) return result;
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = atr;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = parseFloat(atr.toFixed(4));
  }
  return result;
}

/**
 * SuperTrend
 * @param {Array} candles
 * @param {number} period (default 7)
 * @param {number} multiplier (default 3)
 * @returns {{ value: number[], direction: string[] }}
 */
function calculateSuperTrend(candles, period = 7, multiplier = 3) {
  const atr = calculateATR(candles, period);
  const value = new Array(candles.length).fill(null);
  const direction = new Array(candles.length).fill(null);

  let upperBand = null;
  let lowerBand = null;
  let superTrend = null;
  let prevClose = null;

  for (let i = period - 1; i < candles.length; i++) {
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const currATR = atr[i];
    if (currATR === null) continue;

    const newUpper = hl2 + multiplier * currATR;
    const newLower = hl2 - multiplier * currATR;

    // Adjust bands
    const finalUpper = (upperBand === null || newUpper < upperBand || prevClose > upperBand)
      ? newUpper : upperBand;
    const finalLower = (lowerBand === null || newLower > lowerBand || prevClose < lowerBand)
      ? newLower : lowerBand;

    let dir;
    if (superTrend === null) {
      dir = 'up';
    } else if (superTrend === upperBand) {
      dir = c.close <= finalUpper ? 'down' : 'up';
    } else {
      dir = c.close >= finalLower ? 'up' : 'down';
    }

    superTrend = dir === 'up' ? finalLower : finalUpper;
    value[i] = parseFloat(superTrend.toFixed(2));
    direction[i] = dir;

    upperBand = finalUpper;
    lowerBand = finalLower;
    prevClose = c.close;
  }

  return { value, direction };
}

/**
 * OI Change %
 * @param {number} currentOI
 * @param {number} prevOI
 * @returns {number}
 */
function calculateOIChange(currentOI, prevOI) {
  if (!prevOI || prevOI === 0) return 0;
  return parseFloat(((currentOI - prevOI) / prevOI * 100).toFixed(2));
}

/**
 * Compute all indicators for a candle array
 * Returns an object with all indicator values indexed by candle position
 */
function computeAllIndicators(candles) {
  if (!candles || candles.length === 0) return {};

  const closes = candles.map(c => c.close);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ema9 = calculateEMA(closes, 9);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const vwap = calculateVWAP(candles);
  const superTrend = calculateSuperTrend(candles, 7, 3);

  return {
    rsi,
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    ema9,
    ema20,
    ema50,
    ema200,
    vwap,
    superTrendValue: superTrend.value,
    superTrendDirection: superTrend.direction,
  };
}

module.exports = {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateVWAP,
  calculateATR,
  calculateSuperTrend,
  calculateOIChange,
  computeAllIndicators,
};
