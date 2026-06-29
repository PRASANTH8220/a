# NexTrade — Professional Trading Terminal

A full-stack, localhost-only trading terminal combining Groww + TradingView UI quality. Built with Node.js, Redis, MongoDB, and React 18 with Lightweight Charts v4.

---

## Prerequisites

- Node.js 18+
- Redis (running on localhost:6379)
- MongoDB (running on localhost:27017)
- npm

---

## Quick Start

### 1. Start Server

```bash
cd server
npm install
node index.js
```

On first run, `backfill.js` automatically fetches up to 1 year of NSE daily (1D) candle history in the background. This does NOT block the server from starting.

### 2. Start Client

```bash
cd client
npm install
npm run dev
```

### 3. Open in Browser

```
http://localhost:5173
```

---

## Market Data

- **Live data starts at 9:00 AM IST** automatically on trading days
- **Polling stops at 3:31 PM IST** automatically
- NSE holiday calendar is baked in (`server/holidays.js`) — poller skips non-trading days

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `B` | Open Buy panel |
| `S` | Open Sell panel |
| `Esc` | Close order panel |
| `1` | Switch to 1min chart |
| `5` | Switch to 5min chart |
| `F` | Switch to 15min chart |
| `H` | Switch to 1hr chart |

---

## Chart History Limitations

> **1D timeframe:** Full 1-year history available immediately (via backfill on first run).
>
> **1min / 5min / 15min / 1hr:** Only available from the date this server first started running. NSE does not provide historical intraday data. History grows by one day for every trading day the server runs.

The chart shows a note on intraday timeframes indicating the earliest available date.

---

## Paper Trading

- Starting balance: **₹10,00,000** (10 lakhs)
- Top-up: Click balance pill in TopBar → see breakdown; use API directly or reset button
- Reset: Analytics tab → "Reset Account to ₹10L" (shows confirmation modal)
- All trades and balance persist across server restarts via MongoDB

---

## Architecture

```
NSE API → cookie.js → poller.js → Redis (tick storage)
                                → scanner.js → Socket.IO → React
                                → candle.js → MongoDB → REST API → React
backfill.js → MongoDB (1D history on first run)
paperTrading.js → MongoDB (orders, positions, analytics)
```

---

## Environment Variables (optional)

Create `server/.env`:

```env
PORT=3001
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
MONGO_URI=mongodb://127.0.0.1:27017/nextrade
```

---

## PM2 (Production)

```bash
cd server
npm install -g pm2
pm2 start index.js --name nextrade-server
pm2 startup
pm2 save
```

---

## Tech Stack

**Backend:** Node.js, Express, Socket.IO, Redis (ioredis), MongoDB (Mongoose), axios, tough-cookie, node-cron

**Frontend:** React 18, Vite, Lightweight Charts v4, Zustand, Tailwind CSS v3, Socket.IO client, Recharts, Framer Motion, Lucide React

---

## Changelog — Recent Changes

### 1. LTP available even when the market is closed

Previously, LTP only existed in an in-memory cache populated by the live poller (9:00–15:31 IST). Outside that window — after hours, weekends, holidays, or right after a fresh server restart — `/api/quote/:symbol` simply returned 404.

`GET /api/quote/:symbol` now falls back through three tiers:

1. **Live tick** — in-memory cache from the active poller (market open).
2. **On-demand NSE snapshot** — a one-off fetch straight from NSE's quote APIs (`quote-equity`, `allIndices`), which keep returning the last traded price even when the market is shut. The NSE cookie session already refreshes every 25 minutes around the clock, so this works any time of day.
3. **Last stored daily close** — pulled from MongoDB's `1D` candles, as a fully offline fallback.

The response includes a `source` field (`live` / `nse_snapshot` / `last_close`) so the UI can show a "last close" badge when the price isn't live. This same fallback chain now also prices paper-trading orders (`/api/paper/order`, `/api/paper/close`), so trades can still be placed/closed using last-close pricing when the market is closed.

### 2. Dedicated "Stocks (Nifty 500)" section

The old Watchlist mixed Nifty 500, F&O, and indices into one search-to-add list with no way to just browse stocks. Added a new **Stocks tab** in the sidebar (`client/src/components/Stocks/StocksList.jsx`):

- Browses the full Nifty 500 universe, separate from your personal watchlist.
- Toggle between **All 500** and **F&O Only**.
- Search box to filter by symbol.
- Live LTP per row (using the same closed-market fallback above), with inline Buy/Sell.

### 3. F&O stocks: intraday buy/sell *and* options

Equity intraday buy/sell already worked for any symbol generically. The real gap was that **options couldn't be traded from the UI at all** — the option chain table was read-only, and it only ever showed index chains (NIFTY/BANKNIFTY/NIFTY MIDCAP SELECT), silently falling back to NIFTY even when a stock with its own F&O contracts was selected.

- `poller.js` now also rotates through the F&O stock list, polling NSE's `option-chain-equities` endpoint (one stock every 1.5s — too many symbols to refresh at 1s like the indices).
- The Option Chain panel now shows a stock's **own** chain whenever it has F&O contracts, with a visible note when it falls back to NIFTY.
- CE/PE LTP cells have hover Buy/Sell buttons that open the order panel pre-filled with the correct strike, expiry, and option type.
- Orders now carry `optionType` / `strike` / `expiry` end-to-end, and option orders are priced off the option's own premium (not the underlying stock's price).

**Note:** Stock F&O lot sizes vary by symbol and are revised by NSE quarterly, so they aren't hardcoded — the order panel defaults to 1 and shows a note instead of guessing a number that could go stale.

### Files touched

`client/src/App.jsx` · `client/src/components/Layout/Sidebar.jsx` · `client/src/components/MarketWatch/MarketWatch.jsx` · `client/src/components/OptionChain/OptionChain.jsx` · `client/src/components/Orders/OrderPanel.jsx` · `client/src/components/Stocks/StocksList.jsx` (new) · `client/src/store/useOrderStore.js` · `server/index.js` · `server/poller.js`