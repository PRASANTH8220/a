// TVFallbackChart.jsx — drop in client/src/components/Chart/
import React, { useEffect, useRef } from 'react';

const TF_MAP = {
  '1min': '1', '5min': '5', '15min': '15', '1hr': '60', '1D': 'D',
};

const SYM_MAP = {
  'NIFTY': 'NSE:NIFTY50', 'BANKNIFTY': 'NSE:BANKNIFTY', 'SENSEX': 'BSE:SENSEX',
};

export default function TVFallbackChart({ symbol, timeframe }) {
  const containerRef = useRef(null);

  const tvSymbol = SYM_MAP[symbol] || `NSE:${symbol}`;
  const tvInterval = TF_MAP[timeframe] || 'D';

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'Asia/Kolkata',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: '#0B0E11',
      gridColor: '#1E2328',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      studies: [],
      support_host: 'https://www.tradingview.com',
    });

    containerRef.current.appendChild(script);
  }, [tvSymbol, tvInterval]);

  return (
    <div className="tradingview-widget-container" ref={containerRef} style={{ height: '100%', width: '100%' }} />
  );
}