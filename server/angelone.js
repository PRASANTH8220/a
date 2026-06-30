/**
 * angelone.js — AngelOne SmartAPI live feed (replaces NSE cookie polling)
 *
 * Architecture:
 *  1. Login with client_code + password + TOTP → get jwttoken + feedToken
 *  2. Build symbol → token map via SmartAPI searchScrip
 *  3. Connect WebSocketV2, subscribe in batches of 50 (API limit)
 *  4. On every tick: store in Redis + emit via Socket.IO (same contract as old poller)
 *  5. Re-login automatically 5 minutes before token expiry (AngelOne tokens last ~24h)
 *
 * NSE cookies are kept ONLY for option-chain REST calls (no live substitute there).
 * Yahoo Finance handles all historical intraday requests — unchanged.
 */

'use strict';

require('dotenv').config();
const { SmartAPI, WebSocketV2 } = require('smartapi-javascript');
const { TOTP } = require('otpauth');
const { updateTick } = require('./scanner');

// ─── Credentials from .env ─────────────────────────────────────────────────
const API_KEY     = process.env.ANGEL_API_KEY     || '';
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET || '';
const CLIENT_ID   = process.env.ANGEL_CLIENT_ID   || '';
const PASSWORD    = process.env.ANGEL_PASSWORD     || '';
// ────────────────────────────────────────────────────────────────────────────

let redis = null;
let io    = null;

// Session state
let jwtToken   = null;
let feedToken  = null;
let wsV2       = null;
let isLive     = false;
let reLoginTimer = null;

// symbol name → token (e.g. 'RELIANCE' → '2885')
const symbolTokenMap = new Map();
// token → symbol name (reverse)
const tokenSymbolMap = new Map();

/**
 * Generate current TOTP from secret
 */
function generateTOTP() {
  const totp = new TOTP({
    issuer: 'AngelOne',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: TOTP_SECRET,
  });
  return totp.generate();
}

/**
 * Login to AngelOne SmartAPI and return session tokens
 */
async function login() {
  if (!CLIENT_ID || !PASSWORD || !TOTP_SECRET || !API_KEY) {
    console.warn('[Angel] Missing credentials in .env — skipping AngelOne live feed.');
    console.warn('[Angel] Fill ANGEL_CLIENT_ID, ANGEL_PASSWORD, ANGEL_MPIN in server/.env');
    return false;
  }

  try {
    const smart = new SmartAPI({ api_key: API_KEY });
    const totp  = generateTOTP();
    console.log(`[Angel] Logging in as ${CLIENT_ID}...`);
    const session = await smart.generateSession(CLIENT_ID, PASSWORD, totp);

    if (!session?.data?.jwtToken) {
      console.error('[Angel] Login failed:', session?.message || 'unknown error');
      return false;
    }

    jwtToken  = session.data.jwtToken;
    feedToken = session.data.feedToken;
    console.log('[Angel] Login successful. Feed token obtained.');

    // Schedule re-login 23 hours from now (tokens last ~24h)
    if (reLoginTimer) clearTimeout(reLoginTimer);
    reLoginTimer = setTimeout(async () => {
      console.log('[Angel] Re-login: refreshing session...');
      const ok = await login();
      if (ok && wsV2) reconnectWS();
    }, 23 * 60 * 60 * 1000);

    return true;
  } catch (err) {
    console.error('[Angel] Login error:', err.message);
    return false;
  }
}

/**
 * Build symbol→token map for a list of NSE symbols via SmartAPI searchScrip.
 * SmartAPI returns a symboltoken for each scrip.
 * We cache it — tokens don't change intraday.
 */
async function buildTokenMap(symbols) {
  if (!jwtToken) return;
  const smart = new SmartAPI({ api_key: API_KEY, access_token: jwtToken });

  let found = 0;
  // Search in parallel batches of 10 to avoid hammering the API
  const BATCH = 10;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    await Promise.all(batch.map(async (sym) => {
      if (symbolTokenMap.has(sym)) return; // already cached
      try {
        const results = await smart.searchScrip({ exchange: 'NSE', searchscrip: sym });
        if (!Array.isArray(results)) return;
        // Find exact match (trading symbol = sym or symboltoken exists)
        const match = results.find(r =>
          r.tradingsymbol === sym ||
          r.tradingsymbol === `${sym}-EQ`
        ) || results[0];
        if (match?.symboltoken) {
          symbolTokenMap.set(sym, match.symboltoken);
          tokenSymbolMap.set(match.symboltoken, sym);
          found++;
        }
      } catch { /* individual miss — skip */ }
    }));
    await new Promise(r => setTimeout(r, 200)); // 200ms between batches
  }
  console.log(`[Angel] Token map built: ${found}/${symbols.length} symbols resolved.`);
}

/**
 * Hardcoded tokens for NIFTY indices (these don't change)
 * NSE indices have fixed tokens in AngelOne.
 */
const INDEX_TOKENS = {
  'NIFTY':       '26000',
  'BANKNIFTY':   '26009',
  'SENSEX':      '1',      // BSE
  'NIFTY MIDCAP SELECT': '26074',
};
// exchange type for indices = nse_cm (1), except SENSEX = bse_cm (3)
function getExchangeForToken(token) {
  if (token === '1') return 3; // BSE SENSEX
  return 1; // NSE
}

/**
 * Subscribe tokens to WebSocketV2 in batches of 50 (API limit)
 * Mode 2 = QUOTE (LTP + OHLCV)
 */
function subscribeTokens(tokens, exchangeType = 1) {
  if (!wsV2 || !isLive) return;
  const BATCH = 50;
  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    wsV2.fetchData({
      correlationID: `sub_${Date.now()}_${i}`,
      action: 1,      // Subscribe
      mode: 2,        // QUOTE
      exchangeType,
      tokens: batch,
    });
  }
}

/**
 * Store tick in Redis + emit via Socket.IO (same contract as old poller.js)
 */
async function handleTick(raw) {
  try {
    // Price fields from AngelOne come as integer * 100 (paise)
    const token = String(raw.token).trim();
    const symbol = tokenSymbolMap.get(token);
    if (!symbol) return; // unknown token

    const ltp    = (raw.last_traded_price   || 0) / 100;
    const open   = (raw.open_price_day      || 0) / 100;
    const high   = (raw.high_price_day      || 0) / 100;
    const low    = (raw.low_price_day       || 0) / 100;
    const close  = (raw.close_price         || 0) / 100;
    const volume = raw.vol_traded            || 0;
    const oi     = raw.open_interest         || 0;

    if (ltp <= 0) return;

    const tick = {
      symbol,
      ltp:    parseFloat(ltp.toFixed(2)),
      open:   parseFloat(open.toFixed(2)),
      high:   parseFloat(high.toFixed(2)),
      low:    parseFloat(low.toFixed(2)),
      close:  parseFloat(close.toFixed(2)),
      volume,
      oi,
      iv: 0,
      timestamp: Date.now(),
      source: 'angel',
    };

    // Redis: zadd ticks:<symbol> score=timestamp payload=tick (TTL 24h)
    if (redis) {
      const key = `ticks:${symbol}`;
      await redis.zadd(key, tick.timestamp, JSON.stringify(tick));
      await redis.expire(key, 86400);
    }

    // Socket.IO: emit to symbol room
    if (io) io.to(symbol).emit('tick', tick);

    // Scanner
    updateTick(symbol, tick);
  } catch (err) {
    // non-fatal tick parse error
  }
}

/**
 * Connect WebSocketV2 and subscribe all mapped tokens
 */
async function connectWS(symbols) {
  if (!jwtToken || !feedToken) {
    console.error('[Angel] Cannot connect WS: no session tokens.');
    return;
  }

  wsV2 = new WebSocketV2({
    clientcode: CLIENT_ID,
    jwttoken:   `Bearer ${jwtToken}`,
    apikey:     API_KEY,
    feedtype:   feedToken,
  });

  wsV2.on('tick', (ticks) => {
    if (!Array.isArray(ticks)) ticks = [ticks];
    ticks.forEach(handleTick);
  });

  wsV2.on('connect', () => {
    console.log('[Angel] WebSocket connected. Subscribing tokens...');
    isLive = true;

    // Subscribe equity tokens (exchange 1 = NSE CM)
    const equityTokens = [...symbolTokenMap.values()];
    subscribeTokens(equityTokens, 1);

    // Subscribe index tokens (NSE indices, exchange 1)
    const nseIndexTokens = Object.entries(INDEX_TOKENS)
      .filter(([, t]) => t !== '1')
      .map(([sym, token]) => {
        tokenSymbolMap.set(token, sym);
        return token;
      });
    subscribeTokens(nseIndexTokens, 1);

    // SENSEX on BSE (exchange 3)
    tokenSymbolMap.set('1', 'SENSEX');
    subscribeTokens(['1'], 3);

    console.log(`[Angel] Subscribed ${equityTokens.length + nseIndexTokens.length + 1} tokens.`);
  });

  wsV2.on('error', (err) => {
    console.error('[Angel] WebSocket error:', err?.message || err);
    isLive = false;
    // Reconnect after 5s
    setTimeout(() => reconnectWS(), 5000);
  });

  wsV2.on('close', () => {
    if (isLive) {
      console.warn('[Angel] WebSocket closed. Reconnecting in 5s...');
      isLive = false;
      setTimeout(() => reconnectWS(), 5000);
    }
  });

  try {
    await wsV2.connect();
  } catch (err) {
    console.error('[Angel] WS connect failed:', err.message);
    isLive = false;
    setTimeout(() => reconnectWS(), 10000);
  }
}

async function reconnectWS() {
  if (wsV2) {
    try { wsV2.close?.(); } catch {}
    wsV2 = null;
  }
  isLive = false;
  // Re-login if token may have expired
  const ok = await login();
  if (ok) await connectWS([...symbolTokenMap.keys()]);
}

/**
 * Main entry point — called from index.js startup instead of initPollerSchedule
 * when credentials are present.
 *
 * @param {string[]} symbols - NSE symbol names (e.g. ['RELIANCE', 'INFY', ...])
 * @param {object}   redisClient
 * @param {object}   socketIO
 */
async function initAngelOneFeed(symbols, redisClient, socketIO) {
  redis = redisClient;
  io    = socketIO;

  console.log('[Angel] Initialising AngelOne SmartAPI live feed...');

  const ok = await login();
  if (!ok) {
    console.warn('[Angel] Falling back to NSE cookie polling (credentials missing or login failed).');
    return false;
  }

  // Build token map (takes ~10-30s for 500 symbols)
  console.log('[Angel] Building symbol→token map (this takes ~15s)...');
  await buildTokenMap(symbols);

  // Also pre-register index tokens
  for (const [sym, token] of Object.entries(INDEX_TOKENS)) {
    symbolTokenMap.set(sym, token);
    tokenSymbolMap.set(token, sym);
  }

  await connectWS(symbols);
  return true;
}

function stopFeed() {
  isLive = false;
  if (wsV2) {
    try { wsV2.close?.(); } catch {}
    wsV2 = null;
  }
  if (reLoginTimer) { clearTimeout(reLoginTimer); reLoginTimer = null; }
  console.log('[Angel] Live feed stopped.');
}

function isConnected() { return isLive; }

module.exports = { initAngelOneFeed, stopFeed, isConnected, symbolTokenMap, tokenSymbolMap };