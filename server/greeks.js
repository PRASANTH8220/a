/**
 * greeks.js — Black-Scholes Greeks Calculator
 */

const RISK_FREE_RATE = 0.065; // RBI repo rate

/**
 * Standard normal CDF using Abramowitz & Stegun approximation
 */
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal PDF
 */
function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Calculate Black-Scholes Greeks
 * @param {number} S - Underlying price
 * @param {number} K - Strike price
 * @param {number} daysToExpiry - Days remaining to expiry
 * @param {number} iv - Implied volatility as decimal (e.g. 0.18 for 18%)
 * @param {string} type - 'CE' or 'PE'
 * @returns {{ delta, gamma, theta, vega, iv, price }}
 */
function calculateGreeks(S, K, daysToExpiry, iv, type) {
  if (!S || !K || daysToExpiry <= 0 || !iv || iv <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, iv: iv || 0, price: 0 };
  }

  const T = Math.max(daysToExpiry / 365, 0.0001); // Time in years
  const r = RISK_FREE_RATE;
  const sigma = iv;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const Nnd1 = normalCDF(-d1);
  const Nnd2 = normalCDF(-d2);
  const nd1 = normalPDF(d1);

  const discountFactor = Math.exp(-r * T);

  let delta, theta, price;

  if (type === 'CE') {
    delta = Nd1;
    theta = (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * discountFactor * Nd2) / 365;
    price = S * Nd1 - K * discountFactor * Nd2;
  } else {
    // PE
    delta = Nd1 - 1;
    theta = (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * discountFactor * Nnd2) / 365;
    price = K * discountFactor * Nnd2 - S * Nnd1;
  }

  const gamma = nd1 / (S * sigma * sqrtT);
  const vega = S * nd1 * sqrtT / 100; // Per 1% change in IV

  return {
    delta: parseFloat(delta.toFixed(4)),
    gamma: parseFloat(gamma.toFixed(6)),
    theta: parseFloat(theta.toFixed(4)),
    vega: parseFloat(vega.toFixed(4)),
    iv: parseFloat((iv * 100).toFixed(2)),
    price: parseFloat(Math.max(0, price).toFixed(2)),
  };
}

module.exports = { calculateGreeks };
