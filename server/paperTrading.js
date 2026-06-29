/**
 * paperTrading.js — Paper trading engine with ₹10L virtual capital
 */

const mongoose = require('mongoose');

// Schema: paper_account
const AccountSchema = new mongoose.Schema({
  sessionId: { type: String, default: 'default', unique: true },
  totalCapital: { type: Number, default: 1000000 },
  availableBalance: { type: Number, default: 1000000 },
  usedMargin: { type: Number, default: 0 },
  realizedPnL: { type: Number, default: 0 },
  dayPnL: { type: Number, default: 0 },
  lastResetDate: { type: String, default: '' },
}, { timestamps: true });

// Schema: paper_trades
const TradeSchema = new mongoose.Schema({
  sessionId: { type: String, default: 'default' },
  symbol: String,
  expiry: String,
  strike: Number,
  optionType: String, // CE / PE / EQ
  side: String,       // BUY / SELL
  qty: Number,
  entryPrice: Number,
  exitPrice: { type: Number, default: null },
  pnl: { type: Number, default: 0 },
  entryTime: { type: Date, default: Date.now },
  exitTime: { type: Date, default: null },
  status: { type: String, enum: ['OPEN', 'CLOSED', 'PENDING'], default: 'OPEN' },
  orderType: { type: String, enum: ['MARKET', 'LIMIT', 'SL', 'SL-M'], default: 'MARKET' },
  triggerPrice: { type: Number, default: null },
  limitPrice: { type: Number, default: null },
  product: { type: String, enum: ['MIS', 'NRML'], default: 'MIS' },
  marginUsed: { type: Number, default: 0 },
}, { timestamps: true });

let Account, Trade;
try {
  Account = mongoose.model('PaperAccount');
} catch {
  Account = mongoose.model('PaperAccount', AccountSchema);
}
try {
  Trade = mongoose.model('PaperTrade');
} catch {
  Trade = mongoose.model('PaperTrade', TradeSchema);
}

async function getOrCreateAccount(sessionId = 'default') {
  let account = await Account.findOne({ sessionId });
  if (!account) {
    account = await Account.create({ sessionId });
  }
  return account;
}

/**
 * Get account balance breakdown
 */
async function getAccount(sessionId = 'default') {
  const account = await getOrCreateAccount(sessionId);
  const openTrades = await Trade.find({ sessionId, status: 'OPEN' });

  // Calculate unrealized P&L from open positions
  let unrealizedPnL = 0;
  for (const trade of openTrades) {
    if (trade.exitPrice) {
      const pnl = (trade.exitPrice - trade.entryPrice) * trade.qty * (trade.side === 'BUY' ? 1 : -1);
      unrealizedPnL += pnl;
    }
  }

  return {
    totalCapital: account.totalCapital,
    usedMargin: account.usedMargin,
    availableBalance: account.availableBalance,
    unrealizedPnL: parseFloat(unrealizedPnL.toFixed(2)),
    realizedPnL: account.realizedPnL,
    dayPnL: account.dayPnL,
  };
}

/**
 * Estimate margin required for an order
 */
function estimateMargin(symbol, qty, price, orderType, product) {
  // Simplified margin calculation
  // For options: full premium
  // For equity MIS: 20% of order value
  // For equity NRML: 100% of order value
  const orderValue = qty * price;
  if (product === 'MIS') return orderValue * 0.2;
  return orderValue;
}

/**
 * Place a paper order
 */
async function placeOrder({ sessionId = 'default', symbol, expiry, strike, optionType, side, qty, orderType, limitPrice, triggerPrice, currentLTP, product = 'MIS', lotSize = 1 }) {
  const account = await getOrCreateAccount(sessionId);
  const actualQty = qty * (lotSize || 1);
  const price = orderType === 'MARKET' ? currentLTP : limitPrice || currentLTP;
  const marginRequired = estimateMargin(symbol, actualQty, price, orderType, product);

  if (marginRequired > account.availableBalance) {
    return { success: false, error: `Insufficient balance. Required: ₹${marginRequired.toFixed(2)}, Available: ₹${account.availableBalance.toFixed(2)}` };
  }

  const trade = await Trade.create({
    sessionId,
    symbol,
    expiry: expiry || '',
    strike: strike || 0,
    optionType: optionType || 'EQ',
    side,
    qty: actualQty,
    entryPrice: price,
    status: orderType === 'MARKET' ? 'OPEN' : 'PENDING',
    orderType,
    limitPrice,
    triggerPrice,
    product,
    marginUsed: marginRequired,
    entryTime: new Date(),
  });

  // Deduct margin
  account.usedMargin += marginRequired;
  account.availableBalance -= marginRequired;
  await account.save();

  return { success: true, trade };
}

/**
 * Close/square off a position
 */
async function closePosition({ sessionId = 'default', tradeId, exitPrice }) {
  const trade = await Trade.findById(tradeId);
  if (!trade || trade.sessionId !== sessionId) {
    return { success: false, error: 'Trade not found' };
  }
  if (trade.status === 'CLOSED') {
    return { success: false, error: 'Trade already closed' };
  }

  const pnl = (exitPrice - trade.entryPrice) * trade.qty * (trade.side === 'BUY' ? 1 : -1);

  trade.exitPrice = exitPrice;
  trade.exitTime = new Date();
  trade.pnl = parseFloat(pnl.toFixed(2));
  trade.status = 'CLOSED';
  await trade.save();

  // Update account
  const account = await getOrCreateAccount(sessionId);
  account.usedMargin = Math.max(0, account.usedMargin - trade.marginUsed);
  account.availableBalance += trade.marginUsed + pnl;
  account.realizedPnL += pnl;
  account.dayPnL += pnl;
  await account.save();

  return { success: true, trade, pnl };
}

/**
 * Top up account balance
 */
async function topUp({ sessionId = 'default', amount }) {
  if (!amount || amount <= 0) return { success: false, error: 'Invalid amount' };
  const account = await getOrCreateAccount(sessionId);
  account.totalCapital += amount;
  account.availableBalance += amount;
  await account.save();
  return { success: true, account: await getAccount(sessionId) };
}

/**
 * Reset account to ₹10 lakh
 */
async function resetAccount(sessionId = 'default') {
  await Trade.deleteMany({ sessionId });
  await Account.findOneAndUpdate(
    { sessionId },
    {
      totalCapital: 1000000,
      availableBalance: 1000000,
      usedMargin: 0,
      realizedPnL: 0,
      dayPnL: 0,
    },
    { upsert: true }
  );
  return { success: true };
}

/**
 * Get full trade history
 */
async function getTradeHistory(sessionId = 'default') {
  return await Trade.find({ sessionId }).sort({ createdAt: -1 }).lean();
}

/**
 * Get open positions
 */
async function getPositions(sessionId = 'default') {
  return await Trade.find({ sessionId, status: 'OPEN' }).sort({ entryTime: -1 }).lean();
}

/**
 * Get pending orders
 */
async function getPendingOrders(sessionId = 'default') {
  return await Trade.find({ sessionId, status: 'PENDING' }).sort({ createdAt: -1 }).lean();
}

/**
 * Analytics: equity curve, daily P&L, win rate, drawdown
 */
async function getAnalytics(sessionId = 'default') {
  const trades = await Trade.find({ sessionId, status: 'CLOSED' }).sort({ exitTime: 1 }).lean();

  if (trades.length === 0) {
    return {
      equityCurve: [],
      dailyPnL: [],
      winRate: 0,
      avgProfit: 0,
      maxDrawdown: 0,
      bestTrade: 0,
      worstTrade: 0,
      totalTrades: 0,
    };
  }

  // Equity curve
  let balance = 1000000;
  const equityCurve = trades.map(t => {
    balance += t.pnl;
    return { time: t.exitTime, value: parseFloat(balance.toFixed(2)) };
  });

  // Daily P&L
  const dailyMap = {};
  for (const t of trades) {
    const day = new Date(t.exitTime).toISOString().split('T')[0];
    dailyMap[day] = (dailyMap[day] || 0) + t.pnl;
  }
  const dailyPnL = Object.entries(dailyMap)
    .map(([date, pnl]) => ({ date, pnl: parseFloat(pnl.toFixed(2)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Stats
  const winners = trades.filter(t => t.pnl > 0);
  const winRate = (winners.length / trades.length * 100).toFixed(1);
  const avgProfit = (trades.reduce((s, t) => s + t.pnl, 0) / trades.length).toFixed(2);
  const pnls = trades.map(t => t.pnl);
  const bestTrade = Math.max(...pnls);
  const worstTrade = Math.min(...pnls);

  // Max drawdown
  let peak = 1000000;
  let maxDrawdown = 0;
  let bal = 1000000;
  for (const t of trades) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    const dd = (peak - bal) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    equityCurve,
    dailyPnL,
    winRate: parseFloat(winRate),
    avgProfit: parseFloat(avgProfit),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    bestTrade: parseFloat(bestTrade.toFixed(2)),
    worstTrade: parseFloat(worstTrade.toFixed(2)),
    totalTrades: trades.length,
  };
}

module.exports = {
  getAccount,
  placeOrder,
  closePosition,
  topUp,
  resetAccount,
  getTradeHistory,
  getPositions,
  getPendingOrders,
  getAnalytics,
};
