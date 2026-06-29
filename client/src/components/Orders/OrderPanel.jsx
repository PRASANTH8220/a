import React, { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';
import { useMarketStore } from '../../store/useMarketStore';

const LOT_SIZES = { NIFTY: 75, BANKNIFTY: 30, 'NIFTY MIDCAP SELECT': 120 };

const FNO_SET = new Set([
  'AARTIIND','ABB','ABBOTINDIA','ABCAPITAL','ABFRL','ACC','ADANIENT','ADANIPORTS','ALKEM',
  'AMBUJACEM','APOLLOHOSP','APOLLOTYRE','ASHOKLEY','ASIANPAINT','ASTRAL','AUROPHARMA',
  'AXISBANK','BAJAJ-AUTO','BAJAJFINSV','BAJFINANCE','BALKRISIND','BANDHANBNK','BANKBARODA',
  'BATAINDIA','BEL','BERGEPAINT','BHARTIARTL','BHEL','BIOCON','BOSCHLTD','BPCL','BRITANNIA',
  'BSOFT','CANBK','CANFINHOME','CDSL','CESC','CGPOWER','CHAMBLFERT','CHOLAFIN','CIPLA',
  'COALINDIA','COFORGE','COLPAL','CONCOR','CROMPTON','CUMMINSIND','CYIENT','DABUR','DEEPAKNTR',
  'DELTACORP','DELHIVERY','DIVISLAB','DIXON','DLF','DMART','DRREDDY','EICHERMOT','EMAMILTD',
  'ENDURANCE','ESCORTS','EXIDEIND','FACT','FEDERALBNK','FORTIS','GAIL','GLENMARK','GMRAIRPORT',
  'GNFC','GODREJCP','GODREJPROP','GRANULES','GRASIM','GSFC','HAPPSTMNDS','HAVELLS','HCLTECH',
  'HDFCBANK','HDFCLIFE','HEROMOTOCO','HINDALCO','HINDCOPPER','HINDPETRO','HINDUNILVR',
  'ICICIBANK','ICICIPRULI','IDFCFIRSTB','IEX','IGL','INDHOTEL','INDIAMART','INDUSINDBK',
  'INDUSTOWER','INFY','INTELLECT','IOC','IPCALAB','IRB','IRCTC','ITC','JINDALSTEL','JIOFIN',
  'JKCEMENT','JSWSTEEL','JUBFOOD','KOTAKBANK','KRBL','LAURUSLABS','LICHSGFIN','LICI','LT',
  'LTIM','LTTS','LUPIN','M&M','MANAPPURAM','MARICO','MARUTI','MCX','METROPOLIS','MGL',
  'MOTHERSON','MPHASIS','NATIONALUM','NAUKRI','NBCC','NCC','NESTLEIND','NHPC','NMDC','NTPC',
  'OBEROIRLTY','OFSS','ONGC','PAGEIND','PERSISTENT','PETRONET','PFIZER','PHOENIXLTD','PIIND',
  'POLYCAB','POONAWALLA','POWERGRID','PNB','PRAJIND','PRESTIGE','PVRINOX','RAMCOCEM','RECLTD',
  'RELIANCE','RVNL','SAIL','SBICARD','SBILIFE','SBIN','SHRIRAMFIN','SIEMENS','SRF','STAR',
  'SUNPHARMA','SYNGENE','TATACHEM','TATACOMM','TATACONSUM','TATAELXSI','TATAMOTORS','TATAPOWER',
  'TATASTEEL','TCS','TECHM','TITAN','TORNTPHARM','TORNTPOWER','TRENT','TRIDENT','ULTRACEMCO',
  'UPL','VEDL','VOLTAS','WIPRO','YESBANK','ZOMATO','ZYDUSLIFE',
  'NIFTY','BANKNIFTY','NIFTY MIDCAP SELECT','SENSEX',
]);

function calcMargin(symbol, qty, price, product, optionType) {
  const orderValue = qty * price;
  if (product === 'NRML') return { margin: orderValue, leverage: 1, label: 'Full Value' };
  const isFnO = FNO_SET.has(symbol) && optionType && optionType !== 'EQ';
  if (isFnO) return { margin: orderValue, leverage: 1, label: 'Full Premium' };
  return { margin: orderValue * 0.2, leverage: 5, label: '5x Leverage' };
}

export default function OrderPanel() {
  const { orderPanel, updateOrderPanel, closeOrderPanel, placeOrder, account, refreshAccount } = useOrderStore();
  const tick = useMarketStore(s => s.ticks[orderPanel.symbol]);
  const chainData = useMarketStore(s => s.optionChains[orderPanel.symbol]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { refreshAccount(); }, []);
  useEffect(() => { setResult(null); }, [orderPanel.symbol, orderPanel.side]);

  const optionType = orderPanel.optionType || 'EQ';
  const isOption = optionType === 'CE' || optionType === 'PE';

  // For options, price off the specific strike/expiry leg from the live
  // option chain cache rather than the underlying's equity tick.
  const optionRow = isOption && chainData
    ? chainData.chain.find(r => r.strike === orderPanel.strike && r.expiry === orderPanel.expiry)
    : null;
  const optionLeg = optionRow ? optionRow[optionType] : null;

  const lotSize = LOT_SIZES[orderPanel.symbol] || 1;
  const ltp = isOption ? (optionLeg?.ltp || 0) : (tick?.ltp || 0);
  const price = orderPanel.orderType === 'MARKET' ? ltp : parseFloat(orderPanel.limitPrice) || ltp;
  const isFnO = FNO_SET.has(orderPanel.symbol);
  const segmentLabel = isOption ? `F&O · ${optionType}` : isFnO ? 'F&O · EQ' : 'EQ';
  const { margin: marginRequired, leverage, label: leverageLabel } = calcMargin(
    orderPanel.symbol, orderPanel.qty * lotSize, price, orderPanel.product, optionType
  );

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    const res = await placeOrder({
      symbol: orderPanel.symbol,
      side: orderPanel.side,
      qty: parseInt(orderPanel.qty),
      orderType: orderPanel.orderType,
      product: orderPanel.product,
      limitPrice: parseFloat(orderPanel.limitPrice) || null,
      triggerPrice: parseFloat(orderPanel.triggerPrice) || null,
      lotSize,
      optionType,
      strike: orderPanel.strike,
      expiry: orderPanel.expiry,
    });
    setLoading(false);
    setResult(res);
    if (res.success) setTimeout(() => { closeOrderPanel(); setResult(null); }, 1500);
  };

  const isBuy = orderPanel.side === 'BUY';
  const canAfford = marginRequired <= account.availableBalance;

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <h3 className="text-sm font-semibold text-text-primary">Order</h3>
        <button onClick={closeOrderPanel} className="p-1 rounded hover:bg-card text-text-secondary hover:text-text-primary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Buy/Sell Toggle */}
        <div className="flex rounded-md overflow-hidden border border-border">
          {['BUY', 'SELL'].map(side => (
            <button key={side} onClick={() => updateOrderPanel({ side })}
              className={`flex-1 py-2 text-sm font-semibold transition-colors active:scale-[0.97]
                ${orderPanel.side === side
                  ? side === 'BUY' ? 'bg-up text-bg' : 'bg-down text-bg'
                  : 'bg-card text-text-secondary hover:text-text-primary'}`}>
              {side}
            </button>
          ))}
        </div>

        {/* Symbol */}
        <div>
          <label className="text-xs text-text-secondary block mb-1">Symbol</label>
          <div className="bg-card border border-border rounded-md px-3 py-2 text-sm font-semibold text-text-primary">
            {orderPanel.symbol || '—'}
            {isOption && orderPanel.strike && (
              <span className="ml-1">
                {orderPanel.strike} {optionType}
                {orderPanel.expiry && <span className="text-text-secondary font-normal"> · {orderPanel.expiry}</span>}
              </span>
            )}
            {ltp > 0 && <span className="ml-2 tabular-nums text-text-secondary text-xs">{ltp.toFixed(2)}</span>}
            {isOption && !optionLeg && (
              <span className="ml-2 text-warn text-xs font-normal">waiting for chain data...</span>
            )}
          </div>
        </div>

        {/* Order Type */}
        <div>
          <label className="text-xs text-text-secondary block mb-1">Order Type</label>
          <div className="grid grid-cols-4 gap-1">
            {['MARKET', 'LIMIT', 'SL', 'SL-M'].map(type => (
              <button key={type} onClick={() => updateOrderPanel({ orderType: type })}
                className={`py-1.5 text-xs rounded-md border font-medium transition-colors
                  ${orderPanel.orderType === type
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-card text-text-secondary hover:text-text-primary'}`}>
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Product */}
        <div>
          <label className="text-xs text-text-secondary block mb-1">Product</label>
          <div className="grid grid-cols-2 gap-1">
            {['MIS', 'NRML'].map(prod => (
              <button key={prod} onClick={() => updateOrderPanel({ product: prod })}
                className={`py-1.5 text-xs rounded-md border font-medium transition-colors
                  ${orderPanel.product === prod
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-card text-text-secondary hover:text-text-primary'}`}>
                {prod}
              </button>
            ))}
          </div>
        </div>

        {/* Qty */}
        <div>
          <label className="text-xs text-text-secondary block mb-1">
            Qty (lots) — 1 lot = {lotSize} qty
          </label>
          <input type="number" min="1" value={orderPanel.qty}
            onChange={e => updateOrderPanel({ qty: e.target.value })}
            className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-text-primary tabular-nums focus:ring-2 focus:ring-accent focus:border-accent focus:outline-none transition-shadow" />
          {isFnO && !LOT_SIZES[orderPanel.symbol] && (
            <p className="text-[11px] text-text-secondary mt-1">
              Stock F&O lot sizes vary by symbol and are revised by NSE every quarter —
              this defaults to 1 share/contract. Multiply Qty yourself if you want to model a real lot.
            </p>
          )}
        </div>

        {/* Limit Price */}
        {['LIMIT', 'SL', 'SL-M'].includes(orderPanel.orderType) && (
          <div>
            <label className="text-xs text-text-secondary block mb-1">Limit Price</label>
            <input type="number" step="0.05" value={orderPanel.limitPrice}
              onChange={e => updateOrderPanel({ limitPrice: e.target.value })}
              placeholder={ltp.toFixed(2)}
              className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-text-primary tabular-nums focus:ring-2 focus:ring-accent focus:border-accent focus:outline-none transition-shadow" />
          </div>
        )}
        {['SL', 'SL-M'].includes(orderPanel.orderType) && (
          <div>
            <label className="text-xs text-text-secondary block mb-1">Trigger Price</label>
            <input type="number" step="0.05" value={orderPanel.triggerPrice}
              onChange={e => updateOrderPanel({ triggerPrice: e.target.value })}
              className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-text-primary tabular-nums focus:ring-2 focus:ring-accent focus:border-accent focus:outline-none transition-shadow" />
          </div>
        )}

        {/* Margin */}
        <div className="bg-card rounded-lg p-3 space-y-1.5">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-secondary">Segment</span>
            <span className="flex items-center gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isFnO ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>{segmentLabel}</span>
              {orderPanel.product === 'MIS' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400">{leverageLabel}</span>
              )}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Order Value</span>
            <span className="tabular-nums text-text-secondary">
              ₹{(price * orderPanel.qty * lotSize).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Margin Required</span>
            <span className={`tabular-nums font-semibold ${canAfford ? 'text-text-primary' : 'text-down'}`}>
              ₹{marginRequired.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Available</span>
            <span className="tabular-nums text-text-primary">
              ₹{account.availableBalance?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          {!canAfford && (
            <div className="flex items-center gap-1.5 text-down text-xs mt-1">
              <AlertCircle className="w-3.5 h-3.5" />Insufficient balance
            </div>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm
            ${result.success ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>
            {result.success ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {result.success ? 'Order placed!' : result.error}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="p-4 border-t border-border flex-shrink-0">
        <button
          onClick={handleSubmit}
          disabled={loading || !orderPanel.symbol || !canAfford}
          className={`w-full py-3 rounded-md font-semibold text-sm transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
            ${isBuy ? 'bg-up hover:bg-up/90 text-bg' : 'bg-down hover:bg-down/90 text-bg'}`}>
          {loading ? 'Placing...' : `${orderPanel.side} ${orderPanel.symbol || '—'}`}
        </button>
        <p className="text-center text-xs text-text-secondary mt-2">
          Paper trading — no real money
        </p>
      </div>
    </div>
  );
}