/**
 * cookie.js — NSE session cookie manager with auto-refresh
 */

const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cron = require('node-cron');

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'max-age=0',
};

let cookieString = '';
let isRefreshing = false;
let lastRefreshTime = 0;

/**
 * Fetch NSE homepage and extract cookies
 */
async function fetchCookies(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  try {
    console.log(`[Cookie] Fetching NSE cookies (attempt ${attempt})...`);
    await client.get('https://www.nseindia.com', {
      headers: BASE_HEADERS,
      timeout: 15000,
      withCredentials: true,
    });
    // Also hit market-data page to get more cookies
    await new Promise(r => setTimeout(r, 500));
    await client.get('https://www.nseindia.com/market-data/live-equity-market', {
      headers: { ...BASE_HEADERS, Referer: 'https://www.nseindia.com/' },
      timeout: 15000,
      withCredentials: true,
    });

    const cookies = await jar.getCookies('https://www.nseindia.com');
    cookieString = cookies.map(c => `${c.key}=${c.value}`).join('; ');
    lastRefreshTime = Date.now();
    console.log(`[Cookie] Successfully obtained ${cookies.length} cookies`);
    return true;
  } catch (err) {
    console.error(`[Cookie] Failed to fetch cookies: ${err.message}`);
    if (attempt < MAX_ATTEMPTS) {
      const delay = attempt * 10000;
      console.log(`[Cookie] Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      return fetchCookies(attempt + 1);
    }
    console.error('[Cookie] Max attempts reached. Cookie fetch failed.');
    return false;
  }
}

/**
 * Force refresh (called on cookie-death detection)
 */
async function refreshCookies() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    await jar.removeAllCookies();
    await fetchCookies(1);
  } finally {
    isRefreshing = false;
  }
}

/**
 * Get full headers with current cookie string
 */
function getHeaders(referer = 'https://www.nseindia.com/') {
  return {
    ...BASE_HEADERS,
    Cookie: cookieString,
    Referer: referer,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/plain, */*',
  };
}

/**
 * Initialize cookies and schedule auto-refresh every 25 minutes
 */
async function initCookies() {
  await fetchCookies();
  // Refresh every 25 minutes
  cron.schedule('*/25 * * * *', async () => {
    console.log('[Cookie] Scheduled cookie refresh...');
    await refreshCookies();
  });
}

module.exports = { initCookies, getHeaders, refreshCookies };
