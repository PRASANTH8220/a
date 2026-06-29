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
