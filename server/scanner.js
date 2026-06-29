/**
 * scanner.js — Market scanner: top gainers, losers, OI analysis
 */

// In-memory tick store (populated by poller)
const latestTicks = new Map();
let io = null;

function init(socketIO) {
  io = socketIO;
}

function updateTick(symbol, tick) {
  latestTicks.set(symbol, tick);
}

function formatVolume(v) {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return `${v}`;
}

function runScanner() {
  const ticks = Array.from(latestTicks.entries())
    .map(([symbol, tick]) => ({ symbol, ...tick }))
    .filter(t => t.open > 0 && t.ltp > 0);

  // Calculate change %
  const withChange = ticks.map(t => ({
    ...t,
    change: t.ltp - t.open,
    changePct: parseFloat(((t.ltp - t.open) / t.open * 100).toFixed(2)),
  }));

  // Sort for gainers/losers
  const sorted = [...withChange].sort((a, b) => b.changePct - a.changePct);

  const topGainers = sorted.slice(0, 10).map((t, i) => ({
    rank: i + 1,
    symbol: t.symbol,
    ltp: t.ltp,
    change: t.change,
    changePct: t.changePct,
    volume: formatVolume(t.volume || 0),
  }));

  const topLosers = sorted.slice(-10).reverse().map((t, i) => ({
    rank: i + 1,
    symbol: t.symbol,
    ltp: t.ltp,
    change: t.change,
    changePct: t.changePct,
    volume: formatVolume(t.volume || 0),
  }));

  // Most active by volume
  const mostActive = [...withChange]
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 10)
    .map((t, i) => ({
      rank: i + 1,
      symbol: t.symbol,
      ltp: t.ltp,
      changePct: t.changePct,
      volume: formatVolume(t.volume || 0),
    }));

  // OI Buildup: OI increased + price increased
  const oiBuildup = withChange
    .filter(t => t.oi && t.oi > 0 && t.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 10)
    .map((t, i) => ({
      rank: i + 1,
      symbol: t.symbol,
      ltp: t.ltp,
      changePct: t.changePct,
      oi: formatVolume(t.oi || 0),
    }));

  // OI Unwinding: OI decreased
  const oiUnwinding = withChange
    .filter(t => t.oi && t.oi > 0 && t.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 10)
    .map((t, i) => ({
      rank: i + 1,
      symbol: t.symbol,
      ltp: t.ltp,
      changePct: t.changePct,
      oi: formatVolume(t.oi || 0),
    }));

  const results = {
    topGainers,
    topLosers,
    mostActive,
    oiBuildup,
    oiUnwinding,
    timestamp: Date.now(),
  };

  if (io) {
    io.emit('scanner', results);
  }

  return results;
}

let scannerResults = {};

function startScanner(socketIO) {
  io = socketIO;
  // Run every 60 seconds during market hours
  setInterval(() => {
    scannerResults = runScanner();
  }, 60000);

  // Run immediately
  scannerResults = runScanner();
}

function getLatestResults() {
  return scannerResults;
}

function getLatestTick(symbol) {
  return latestTicks.get(symbol) || null;
}

function getAllTicks() {
  return Object.fromEntries(latestTicks);
}

module.exports = { init, updateTick, startScanner, getLatestResults, getLatestTick, getAllTicks };
