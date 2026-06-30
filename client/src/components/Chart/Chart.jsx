import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { useChartStore } from '../../store/useChartStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useOrderStore } from '../../store/useOrderStore';
import ChartToolbar from './ChartToolbar';
import TVFallbackChart from './TVFallbackChart';
import { ArrowLeft, Radio } from 'lucide-react';

const TIMEFRAMES = ['1min', '5min', '15min', '1hr', '1D'];
const TF_LABELS = { '1min': '1m', '5min': '5m', '15min': '15m', '1hr': '1H', '1D': '1D' };
// Drill-down timeframes shown when user clicks a past daily candle
const DRILL_TIMEFRAMES = ['5min', '15min', '1hr'];

const CHART_COLORS = {
  background: '#0B0E11',
  text: '#848E9C',
  grid: '#1E2328',
  border: '#2A2E35',
  up: '#0ECB81',
  down: '#F6465D',
};

// Format a JS timestamp (ms) → 'YYYY-MM-DD'
function toDateStr(tsMs) {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Format 'YYYY-MM-DD' → '27 Jun 2026'
function fmtDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Is a 'YYYY-MM-DD' string today in IST?
function isToday(dateStr) {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const t = `${nowIST.getFullYear()}-${String(nowIST.getMonth()+1).padStart(2,'0')}-${String(nowIST.getDate()).padStart(2,'0')}`;
  return dateStr === t;
}

export default function Chart() {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const indicatorSeriesRefs = useRef({});
  const positionLinesRef = useRef([]);
  const isLoadingMore = useRef(false);

  const { symbol, timeframe, candles, indicators, enabledIndicators,
    isLoading, serverStartDate, hasMore, symbolLoadId,
    setSymbol, setTimeframe, setCandles, appendCandles, setLoading, setServerStartDate } = useChartStore();
  const tick = useMarketStore(s => s.ticks[symbol]);
  const positions = useOrderStore(s => s.positions);
  const { openOrderPanel } = useOrderStore();

  const [ohlcv, setOhlcv] = useState(null);
  const [chartReady, setChartReady] = useState(false);

  // ── History / Drill-down mode ────────────────────────────────────────────
  // drillDate: 'YYYY-MM-DD' | null — null means normal mode
  const [drillDate, setDrillDate] = useState(null);
  const [drillTf, setDrillTf] = useState('5min');
  const [drillCandles, setDrillCandles] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const isDrillMode = drillDate !== null;
  const drillIsToday = drillDate ? isToday(drillDate) : false;

  // Enter drill-down when user clicks a candle on the 1D chart
  const enterDrill = useCallback((tsSeconds) => {
    const dateStr = toDateStr(tsSeconds * 1000);
    setDrillDate(dateStr);
    setDrillTf('5min');
  }, []);

  // Exit drill-down back to 1D view
  const exitDrill = useCallback(() => {
    setDrillDate(null);
    setDrillCandles([]);
  }, []);

  // Fetch drill-down candles whenever date/tf changes
  useEffect(() => {
    if (!drillDate) return;
    setDrillLoading(true);
    setDrillCandles([]);
    fetch(`/api/drilldown/${symbol}/${drillTf}?date=${drillDate}`)
      .then(r => r.json())
      .then(data => setDrillCandles(data.candles || []))
      .catch(err => console.error('[Drilldown] fetch error:', err))
      .finally(() => setDrillLoading(false));
  }, [drillDate, drillTf, symbol]);

  // ── Normal candle fetch ─────────────────────────────────────────────────
  const fetchCandles = useCallback(async (sym, tf, before = null) => {
    setLoading(true);
    try {
      if (tf === '1D' && !before) {
        fetch(`/api/history/${sym}`).catch(() => {});
        await new Promise(r => setTimeout(r, 600));
      }
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

  // ── Chart init ──────────────────────────────────────────────────────────
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

    const candleSeries = chart.addCandlestickSeries({
      upColor: CHART_COLORS.up,
      downColor: CHART_COLORS.down,
      borderUpColor: CHART_COLORS.up,
      borderDownColor: CHART_COLORS.down,
      wickUpColor: CHART_COLORS.up,
      wickDownColor: CHART_COLORS.down,
    });
    candleSeriesRef.current = candleSeries;

    const volSeries = chart.addHistogramSeries({
      color: '#1E88E530',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volSeries;

    chart.subscribeCrosshairMove((param) => {
      if (param.seriesData) {
        const d = param.seriesData.get(candleSeries);
        if (d) setOhlcv(d);
      }
    });

    // Click on a candle in 1D mode → drill into that day
    chart.subscribeClick((param) => {
      if (!param.time) return;
      const currentTf = useChartStore.getState().timeframe;
      const currentDrill = param._drillDate; // avoid stale closure
      // Only drill when on 1D and not already in drill mode
      if (currentTf === '1D') {
        const dateStr = toDateStr(param.time * 1000);
        setDrillDate(dateStr);
        setDrillTf('5min');
      }
    });

    // Infinite scroll for normal mode
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || isLoadingMore.current || !hasMore) return;
      if (range.from < 10) {
        const state = useChartStore.getState();
        if (state.timeframe !== '1D') return; // only paginate 1D
        isLoadingMore.current = true;
        const oldest = state.candles[0];
        if (oldest) {
          fetchCandles(state.symbol, state.timeframe, oldest.time).then(older => {
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

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.resize(containerRef.current.offsetWidth, containerRef.current.offsetHeight);
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      setChartReady(false);
    };
  }, []);

  // ── Load 1D candles on symbol/timeframe change ──────────────────────────
  useEffect(() => {
    if (!chartReady || isDrillMode) return;
    const loadId = symbolLoadId;
    const load = async () => {
      const data = await fetchCandles(symbol, timeframe);
      if (useChartStore.getState().symbolLoadId !== loadId) return;
      setCandles(data);
    };
    load();
  }, [symbol, timeframe, chartReady, symbolLoadId, isDrillMode]);

  // ── Render normal candles ───────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || isDrillMode) return;
    if (!candles.length) return;
    const mapped = candles.map(c => ({ ...c, time: Math.floor(c.time / 1000) }));
    candleSeriesRef.current.setData(mapped);
    volumeSeriesRef.current?.setData(candles.map(c => ({
      time: Math.floor(c.time / 1000),
      value: c.volume || 0,
      color: c.close >= c.open ? '#0ECB8130' : '#F6465D30',
    })));
    chartRef.current?.timeScale().fitContent();
    renderIndicators();
  }, [candles, chartReady, isDrillMode]);

  // ── Render drill-down candles ───────────────────────────────────────────
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || !isDrillMode) return;
    if (!drillCandles.length) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current?.setData([]);
      return;
    }
    const mapped = drillCandles.map(c => ({ ...c, time: Math.floor(c.time / 1000) }));
    candleSeriesRef.current.setData(mapped);
    volumeSeriesRef.current?.setData(drillCandles.map(c => ({
      time: Math.floor(c.time / 1000),
      value: c.volume || 0,
      color: c.close >= c.open ? '#0ECB8130' : '#F6465D30',
    })));
    chartRef.current?.timeScale().fitContent();
  }, [drillCandles, chartReady, isDrillMode]);

  // ── Live tick update (today's candle OR drill-mode today) ──────────────
  useEffect(() => {
    if (!tick?.ltp || !candleSeriesRef.current) return;
    // In drill mode only update if drilling today
    if (isDrillMode && !drillIsToday) return;

    const src = isDrillMode ? drillCandles : candles;
    const last = src[src.length - 1];
    if (!last) return;
    candleSeriesRef.current.update({
      time: Math.floor(last.time / 1000),
      open: last.open,
      high: Math.max(last.high, tick.ltp),
      low: Math.min(last.low, tick.ltp),
      close: tick.ltp,
    });
  }, [tick?.ltp]);

  // ── Indicators ──────────────────────────────────────────────────────────
  const renderIndicators = useCallback(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    const chart = chartRef.current;
    const { enabledIndicators: ei, indicators: ind, candles: cv } = useChartStore.getState();

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
      if (ind.ema9)  addLine('ema9',  zip(ind.ema9),  '#F0B90B');
      if (ind.ema20) addLine('ema20', zip(ind.ema20), '#FF9800');
      if (ind.ema50) addLine('ema50', zip(ind.ema50), '#9C27B0');
    }
    if (ei.bb && ind.bbUpper) {
      addLine('bbUpper',  zip(ind.bbUpper),  '#1E88E580', LineStyle.Dashed);
      addLine('bbMiddle', zip(ind.bbMiddle), '#1E88E540', LineStyle.Dashed);
      addLine('bbLower',  zip(ind.bbLower),  '#1E88E580', LineStyle.Dashed);
    }
    if (ei.superTrend && ind.superTrendValue) {
      const upPts = [], downPts = [];
      ind.superTrendValue.forEach((v, i) => {
        if (v === null) return;
        const pt = { time: times[i], value: v };
        if (ind.superTrendDirection[i] === 'up') upPts.push(pt);
        else downPts.push(pt);
      });
      if (upPts.length)   addLine('stUp',   upPts,   '#0ECB81');
      if (downPts.length) addLine('stDown', downPts, '#F6465D');
    }
  }, []);

  useEffect(() => {
    if (chartReady && !isDrillMode) renderIndicators();
  }, [enabledIndicators, indicators, chartReady, isDrillMode]);

  // ── Position lines ──────────────────────────────────────────────────────
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
      <ChartToolbar symbol={symbol} ohlcv={ohlcv} tick={tick} />

      {/* Timeframe row + drill-down breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface flex-shrink-0 flex-wrap">

        {isDrillMode ? (
          /* ── DRILL MODE: breadcrumb + intraday TF switcher ── */
          <>
            <button
              onClick={exitDrill}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-secondary hover:text-accent hover:bg-card transition-colors mr-1"
              title="Back to 1D chart"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>1D</span>
            </button>
            <span className="text-text-secondary text-xs">›</span>
            <span className="text-xs font-semibold text-text-primary mx-1">
              {fmtDateDisplay(drillDate)}
            </span>
            {drillIsToday && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-up/15 text-up border border-up/30 mr-1">
                <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
              </span>
            )}
            <span className="text-text-secondary text-xs mr-2">›</span>
            {DRILL_TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => setDrillTf(tf)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors active:scale-[0.97]
                  ${drillTf === tf ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary hover:bg-card'}`}>
                {TF_LABELS[tf]}
              </button>
            ))}
            <div className="flex-1" />
            {!drillIsToday && (
              <span className="text-[10px] text-text-secondary italic">
                Historical · Yahoo Finance
              </span>
            )}
          </>
        ) : (
          /* ── NORMAL MODE: timeframe + indicator toggles ── */
          <>
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
            {timeframe === '1D' && (
              <span className="ml-2 text-[10px] text-text-secondary italic">
                Click any candle to drill into that day
              </span>
            )}
          </>
        )}
      </div>

      {/* Chart container */}
      <div className="flex-1 relative overflow-hidden" ref={containerRef}>
        {(isLoading || drillLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60 z-10">
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              {drillLoading ? `Loading ${fmtDateDisplay(drillDate)}...` : 'Loading...'}
            </div>
          </div>
        )}
        {!isLoading && !drillLoading && (isDrillMode ? drillCandles : candles).length === 0 && (
          isDrillMode ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-secondary">
              <span className="text-sm">No intraday data for {fmtDateDisplay(drillDate)}</span>
              <span className="text-xs opacity-60">
                {drillDate < '2025-01-01'
                  ? 'Yahoo only provides 1H data beyond 60 days'
                  : 'Market may have been closed on this day'}
              </span>
              <button onClick={exitDrill}
                className="mt-2 px-3 py-1.5 rounded text-xs bg-card hover:bg-card/80 border border-border text-text-primary transition-colors">
                ← Back to 1D
              </button>
            </div>
          ) : (
            <div className="absolute inset-0">
              <TVFallbackChart symbol={symbol} timeframe={timeframe} />
            </div>
          )
        )}
        {intraday && serverStartDate && !isDrillMode && (
          <div className="absolute bottom-8 left-3 z-10 bg-card/80 border border-border rounded px-2 py-1 text-xs text-text-secondary">
            Intraday history available from {serverStart}
          </div>
        )}
      </div>
    </div>
  );
}