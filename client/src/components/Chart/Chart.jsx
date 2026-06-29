import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { useChartStore } from '../../store/useChartStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useOrderStore } from '../../store/useOrderStore';
import ChartToolbar from './ChartToolbar';
import TVFallbackChart from './TVFallbackChart';

const TIMEFRAMES = ['1min', '5min', '15min', '1hr', '1D'];
const TF_LABELS = { '1min': '1m', '5min': '5m', '15min': '15m', '1hr': '1H', '1D': '1D' };

const CHART_COLORS = {
  background: '#0B0E11',
  text: '#848E9C',
  grid: '#1E2328',
  border: '#2A2E35',
  up: '#0ECB81',
  down: '#F6465D',
};

export default function Chart() {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const macdSeriesRef = useRef(null);
  const indicatorSeriesRefs = useRef({});
  const positionLinesRef = useRef([]);
  const isLoadingMore = useRef(false);

  const { symbol, timeframe, candles, indicators, enabledIndicators,
    isLoading, serverStartDate, hasMore,
    setSymbol, setTimeframe, setCandles, appendCandles, setLoading, setServerStartDate } = useChartStore();
  const tick = useMarketStore(s => s.ticks[symbol]);
  const positions = useOrderStore(s => s.positions);
  const { openOrderPanel } = useOrderStore();

  const [ohlcv, setOhlcv] = useState(null);
  const [chartReady, setChartReady] = useState(false);

  // Fetch candles from API
  const fetchCandles = useCallback(async (sym, tf, before = null) => {
    setLoading(true);
    try {
      let url = `/api/candles/${sym}/${tf}?limit=200`;
      if (before) url += `&before=${before}`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.serverStartDate) setServerStartDate(data.serverStartDate);
      return data.candles || [];
    } catch (err) {
      console.error('[Chart] Fetch error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [setLoading, setServerStartDate]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: CHART_COLORS.background },
        textColor: CHART_COLORS.text,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#4B5563', width: 1, style: LineStyle.Dashed },
        horzLine: { color: '#4B5563', width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.border,
        textColor: CHART_COLORS.text,
        scaleMargins: { top: 0.1, bottom: 0.3 },
      },
      timeScale: {
        borderColor: CHART_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightBarStaysOnScroll: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: CHART_COLORS.up,
      downColor: CHART_COLORS.down,
      borderUpColor: CHART_COLORS.up,
      borderDownColor: CHART_COLORS.down,
      wickUpColor: CHART_COLORS.up,
      wickDownColor: CHART_COLORS.down,
    });
    candleSeriesRef.current = candleSeries;

    // Volume series
    const volSeries = chart.addHistogramSeries({
      color: '#1E88E530',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volSeries;

    // Crosshair subscription for OHLCV display
    chart.subscribeCrosshairMove((param) => {
      if (param.seriesData) {
        const d = param.seriesData.get(candleSeries);
        if (d) setOhlcv(d);
      }
    });

    // Infinite scroll: load more on scroll left
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || isLoadingMore.current || !hasMore) return;
      if (range.from < 10) {
        isLoadingMore.current = true;
        const oldest = useChartStore.getState().candles[0];
        if (oldest) {
          fetchCandles(
            useChartStore.getState().symbol,
            useChartStore.getState().timeframe,
            oldest.time
          ).then(older => {
            if (older.length) {
              appendCandles(older);
              const all = [...older, ...useChartStore.getState().candles];
              candleSeries.setData(all.map(c => ({ ...c, time: Math.floor(c.time / 1000) })));
              volSeries.setData(all.map(c => ({
                time: Math.floor(c.time / 1000),
                value: c.volume || 0,
                color: c.close >= c.open ? '#0ECB8130' : '#F6465D30',
              })));
            }
            isLoadingMore.current = false;
          });
        } else {
          isLoadingMore.current = false;
        }
      }
    });

    setChartReady(true);

    const handleResize = () => {
      if (containerRef.current) {
        chart.resize(containerRef.current.offsetWidth, containerRef.current.offsetHeight);
      }
    };
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      setChartReady(false);
    };
  }, []);

  // Load candles when symbol/timeframe changes
  useEffect(() => {
    if (!chartReady) return;
    const load = async () => {
      const data = await fetchCandles(symbol, timeframe);
      setCandles(data);
    };
    load();
  }, [symbol, timeframe, chartReady]);

  // Render candles on chart
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || !candles.length) return;
    const mapped = candles.map(c => ({ ...c, time: Math.floor(c.time / 1000) }));
    candleSeriesRef.current.setData(mapped);
    volumeSeriesRef.current?.setData(candles.map(c => ({
      time: Math.floor(c.time / 1000),
      value: c.volume || 0,
      color: c.close >= c.open ? '#0ECB8130' : '#F6465D30',
    })));
    // Fit to data
    chartRef.current?.timeScale().fitContent();
    // Render indicators
    renderIndicators();
  }, [candles, chartReady]);

  // Live tick update
  useEffect(() => {
    if (!tick?.ltp || !candleSeriesRef.current || !candles.length) return;
    const last = candles[candles.length - 1];
    if (!last) return;
    candleSeriesRef.current.update({
      time: Math.floor(last.time / 1000),
      open: last.open,
      high: Math.max(last.high, tick.ltp),
      low: Math.min(last.low, tick.ltp),
      close: tick.ltp,
    });
  }, [tick?.ltp]);

  // Render indicator series
  const renderIndicators = useCallback(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    const chart = chartRef.current;
    const { enabledIndicators: ei, indicators: ind, candles: cv } = useChartStore.getState();

    // Clear old series
    Object.values(indicatorSeriesRefs.current).forEach(s => {
      try { chart.removeSeries(s); } catch {}
    });
    indicatorSeriesRefs.current = {};

    if (!cv.length || !ind) return;
    const times = cv.map(c => Math.floor(c.time / 1000));

    const addLine = (key, data, color, lineStyle = LineStyle.Solid, priceScaleId = 'right') => {
      if (!data || !data.length) return;
      const series = chart.addLineSeries({
        color, lineWidth: 1.5, lineStyle, priceScaleId,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      });
      series.setData(data.filter(d => d.value !== null).map(d => d));
      indicatorSeriesRefs.current[key] = series;
    };

    const zip = (arr) => times.map((t, i) => ({ time: t, value: arr[i] })).filter(d => d.value !== null && d.value !== undefined);

    if (ei.vwap && ind.vwap) addLine('vwap', zip(ind.vwap), '#1E88E5', LineStyle.Dashed);
    if (ei.ema) {
      if (ind.ema9) addLine('ema9', zip(ind.ema9), '#F0B90B');
      if (ind.ema20) addLine('ema20', zip(ind.ema20), '#FF9800');
      if (ind.ema50) addLine('ema50', zip(ind.ema50), '#9C27B0');
    }
    if (ei.bb && ind.bbUpper) {
      addLine('bbUpper', zip(ind.bbUpper), '#1E88E580', LineStyle.Dashed);
      addLine('bbMiddle', zip(ind.bbMiddle), '#1E88E540', LineStyle.Dashed);
      addLine('bbLower', zip(ind.bbLower), '#1E88E580', LineStyle.Dashed);
    }
    if (ei.superTrend && ind.superTrendValue) {
      // Split into bullish/bearish segments
      const upPts = [], downPts = [];
      ind.superTrendValue.forEach((v, i) => {
        if (v === null) return;
        const pt = { time: times[i], value: v };
        if (ind.superTrendDirection[i] === 'up') upPts.push(pt);
        else downPts.push(pt);
      });
      if (upPts.length) addLine('stUp', upPts, '#0ECB81');
      if (downPts.length) addLine('stDown', downPts, '#F6465D');
    }
  }, []);

  useEffect(() => {
    if (chartReady) renderIndicators();
  }, [enabledIndicators, indicators, chartReady]);

  // Position lines
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    positionLinesRef.current.forEach(l => { try { candleSeriesRef.current.removePriceLine(l); } catch {} });
    positionLinesRef.current = [];

    const symPositions = positions.filter(p => p.symbol === symbol);
    symPositions.forEach(pos => {
      const line = candleSeriesRef.current.createPriceLine({
        price: pos.entryPrice,
        color: pos.side === 'BUY' ? '#1E88E5' : '#F0B90B',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${pos.side} ${pos.qty}@${pos.entryPrice}`,
      });
      positionLinesRef.current.push(line);
    });
  }, [positions, symbol, chartReady]);

  const intraday = ['1min', '5min', '15min', '1hr'].includes(timeframe);
  const serverStart = serverStartDate ? new Date(serverStartDate).toLocaleDateString('en-IN') : '—';

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-hidden min-h-0">
      {/* Chart header toolbar */}
      <ChartToolbar symbol={symbol} ohlcv={ohlcv} tick={tick} />

      {/* Timeframe + Indicator toggles */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-1 mr-3">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors active:scale-[0.97]
                ${timeframe === tf ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary hover:bg-card'}`}>
              {TF_LABELS[tf]}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        {[
          { key: 'vwap', label: 'VWAP' },
          { key: 'superTrend', label: 'ST' },
          { key: 'ema', label: 'EMA' },
          { key: 'bb', label: 'BB' },
          { key: 'rsi', label: 'RSI' },
          { key: 'macd', label: 'MACD' },
        ].map(({ key, label }) => (
          <button key={key}
            onClick={() => useChartStore.getState().toggleIndicator(key)}
            className={`px-2 py-1 rounded text-xs transition-colors active:scale-[0.97]
              ${enabledIndicators[key] ? 'bg-accent/20 text-accent border border-accent/40' : 'text-text-secondary hover:text-text-primary hover:bg-card border border-transparent'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Chart container */}
      <div className="flex-1 relative overflow-hidden" ref={containerRef}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60 z-10">
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Loading...
            </div>
          </div>
        )}
        {!isLoading && candles.length === 0 && (
          <div className="absolute inset-0">
            <TVFallbackChart symbol={symbol} timeframe={timeframe} />
          </div>
        )}
        {intraday && serverStartDate && (
          <div className="absolute bottom-8 left-3 z-10 bg-card/80 border border-border rounded px-2 py-1 text-xs text-text-secondary">
            Intraday history available from {serverStart}
          </div>
        )}
      </div>
    </div>
  );
}