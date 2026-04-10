const BYBIT_BASE = 'https://api.bybit.com/v5/market';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

function roundToStep(value, step) {
  if (!step || step <= 0) return value;
  const precision = Math.max(0, (step.toString().split('.')[1] || '').length);
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
}

function roundToTick(value, tick) {
  if (!tick || tick <= 0) return value;
  const precision = Math.max(0, (tick.toString().split('.')[1] || '').length);
  const rounded = Math.floor(value / tick) * tick;
  return Number(rounded.toFixed(precision));
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Referer": "https://www.bybit.com/",
        "Origin": "https://www.bybit.com"
      }
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bybit request failed (${res.status}): ${text.slice(0, 120)}`);
    }
    
    return await res.json();
    
  } finally {
    clearTimeout(timer);
  }
}

function unwrapListResponse(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.result?.list && Array.isArray(data.result.list)) return data.result.list;
  if (data?.result && Array.isArray(data.result)) return data.result;
  return [];
}

function parseKlinesBybit(data) {
  return unwrapListResponse(data)
    .map(k => ({
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[0]) + 60_000,
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) emaVal = values[i] * k + emaVal * (1 - k);
  return emaVal;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (values.length < slow + signalPeriod) return null;

  const emaFastSeries = [];
  const emaSlowSeries = [];
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);

  let fastEma = values.slice(0, fast).reduce((a, b) => a + b, 0) / fast;
  let slowEma = values.slice(0, slow).reduce((a, b) => a + b, 0) / slow;

  for (let i = 0; i < values.length; i++) {
    if (i >= fast) fastEma = values[i] * kFast + fastEma * (1 - kFast);
    if (i >= slow) slowEma = values[i] * kSlow + slowEma * (1 - kSlow);
    if (i >= slow - 1) {
      emaFastSeries.push(fastEma);
      emaSlowSeries.push(slowEma);
    }
  }

  const macdLineSeries = emaFastSeries.slice(-emaSlowSeries.length).map((v, i) => v - emaSlowSeries[i]);
  const signalLine = ema(macdLineSeries, signalPeriod);
  const macdLine = macdLineSeries[macdLineSeries.length - 1];
  const hist = macdLine - signalLine;
  return { macdLine, signalLine, histogram: hist };
}

function bollinger(values, period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + ((b - mean) ** 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { middle: mean, upper: mean + mult * sd, lower: mean - mult * sd };
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trs.push(tr);
  }
  const last = trs.slice(-period);
  return last.reduce((a, b) => a + b, 0) / period;
}

function volumeAnalysis(candles) {
  const volumes = candles.map(c => c.volume);
  const current = volumes[volumes.length - 1];
  const avgSlice = volumes.slice(Math.max(0, volumes.length - 21), -1);
  const avg = avgSlice.reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, volumes.length - 1));
  const spike = avg > 0 ? current > 1.5 * avg : false;
  const prevSlice = volumes.slice(Math.max(0, volumes.length - 11), -1);
  const prevAvg = prevSlice.reduce((a, b) => a + b, 0) / Math.max(1, Math.min(10, volumes.length - 1));
  const trend = current >= prevAvg ? 'UP' : 'DOWN';
  return { current, average: avg, spike, trend };
}

function orderBookAnalysis(depth) {
  const bidsRaw = depth?.result?.b || depth?.b || [];
  const asksRaw = depth?.result?.a || depth?.a || [];
  const bids = bidsRaw.slice(0, 20).map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
  const asks = asksRaw.slice(0, 20).map(([p, q]) => ({ price: Number(p), qty: Number(q) }));

  const bidVolume = bids.reduce((a, b) => a + b.qty, 0);
  const askVolume = asks.reduce((a, b) => a + b.qty, 0);
  const pressureRatio = askVolume === 0 ? Infinity : bidVolume / askVolume;
  const pressure = pressureRatio >= 1.08 ? 'BUY' : pressureRatio <= 0.92 ? 'SELL' : 'NEUTRAL';
  const bestBid = bids[0]?.price || null;
  const bestAsk = asks[0]?.price || null;
  const spread = (bestBid && bestAsk) ? bestAsk - bestBid : null;
  const spreadPct = (bestBid && bestAsk) ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100 : null;

  const bidWall = bids.reduce((max, row) => row.qty > max.qty ? row : max, { qty: 0, price: null });
  const askWall = asks.reduce((max, row) => row.qty > max.qty ? row : max, { qty: 0, price: null });

  return {
    bidVolume,
    askVolume,
    pressureRatio: Number.isFinite(pressureRatio) ? pressureRatio : null,
    pressure,
    spread,
    spreadPct,
    bestBid,
    bestAsk,
    bidWall,
    askWall,
  };
}

function tapeAnalysis(tradesData) {
  const trades = unwrapListResponse(tradesData);
  let buyQty = 0;
  let sellQty = 0;
  let buyCount = 0;
  let sellCount = 0;

  for (const t of trades) {
    const qty = Number(t.size ?? t.qty ?? 0);
    const side = String(t.side || '').toLowerCase();
    if (side === 'buy') {
      buyQty += qty;
      buyCount += 1;
    } else if (side === 'sell') {
      sellQty += qty;
      sellCount += 1;
    }
  }

  const dominance = buyQty >= sellQty ? 'BUY' : 'SELL';
  const ratio = sellQty === 0 ? Infinity : buyQty / sellQty;
  return { buyQty, sellQty, buyCount, sellCount, dominance, ratio: Number.isFinite(ratio) ? ratio : null };
}

function trendState(candles1m, candles5m, ema9, ema21, sma50, rsi14, macdData, atr14) {
  const lastClose1m = candles1m[candles1m.length - 1].close;
  const last5mClose = candles5m[candles5m.length - 1].close;
  const emaGapPct = Math.abs(ema9 - ema21) / lastClose1m * 100;
  const atrPct = atr14 ? (atr14 / lastClose1m) * 100 : 0;

  const bullishAlignment = ema9 > ema21 && lastClose1m > sma50 && lastClose1m >= last5mClose * 0.999;
  const bearishAlignment = ema9 < ema21 && lastClose1m < sma50 && lastClose1m <= last5mClose * 1.001;

  let marketCondition = 'SIDEWAYS';
  if ((emaGapPct >= 0.08 && atrPct >= 0.06) || bullishAlignment || bearishAlignment) {
    marketCondition = 'TRENDING';
  }

  return {
    marketCondition,
    emaGapPct,
    atrPct,
    bullishAlignment,
    bearishAlignment,
    macdBullish: macdData ? macdData.histogram > 0 : null,
    macdBearish: macdData ? macdData.histogram < 0 : null,
  };
}

function buildReason(parts) {
  return parts.filter(Boolean).join(' ');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const symbol = String(body.symbol || 'BTCUSDT').toUpperCase().trim();
    const category = String(body.category || 'linear').toLowerCase() === 'spot' ? 'spot' : 'linear';
    const capital = Math.max(10, Number(body.capital || 100));
    const riskPercent = clamp(Number(body.riskPercent || 1), 1, 2);
    const leverageMode = body.leverageMode === 'manual' ? 'manual' : 'auto';
    const manualLeverage = clamp(Number(body.leverage || 5), 1, 125);
    
    const [kline1mRes, kline5mRes, orderbookRes, tradesRes] = await Promise.all([
  fetchJson(`${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=120`),
  fetchJson(`${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${symbol}&interval=5&limit=120`),
  fetchJson(`${BYBIT_BASE}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=50`),
  fetchJson(`${BYBIT_BASE}/v5/market/recent-trade?category=linear&symbol=${symbol}&limit=50`)
]);
   
   const klines1mRaw = kline1mRes.result.list;
const klines5mRaw = kline5mRes.result.list;

// format Bybit → Binance style
function convertKlines(data) {
  return data.map(k => ([
    Number(k[0]), // time
    k[1], // open
    k[2], // high
    k[3], // low
    k[4], // close
    k[5], // volume
    k[0] // closeTime dummy
  ])).reverse();
}

const depth = {
  bids: orderbookRes.result.b.map(i => [i[0], i[1]]),
  asks: orderbookRes.result.a.map(i => [i[0], i[1]])
};

const trades = tradesRes.result.list.map(t => ({
  qty: t.size,
  isBuyerMaker: t.side === "Sell"
}));
    const candles1m = parseKlinesBybit(klines1mRaw);
    const candles5m = parseKlinesBybit(klines5mRaw);

    if (candles1m.length < 60 || candles5m.length < 60) {
      throw new Error('Insufficient candle history returned by Bybit.');
    }

    const closes1m = candles1m.map(c => c.close);

    const ema9 = ema(closes1m, 9);
    const ema21 = ema(closes1m, 21);
    const sma50 = sma(closes1m, 50);
    const rsi14 = rsi(closes1m, 14);
    const macdData = macd(closes1m, 12, 26, 9);
    const bb = bollinger(closes1m, 20, 2);
    const atr14 = atr(candles1m, 14);
    const volume = volumeAnalysis(candles1m);
    const ob = orderBookAnalysis(depth);
    const tape = tapeAnalysis(trades);
    const trend = trendState(candles1m, candles5m, ema9, ema21, sma50, rsi14, macdData, atr14);

    const lastCandle = candles1m[candles1m.length - 1];
    const entry = Number(ob.bestAsk || lastCandle.close);
    const currentPrice = lastCandle.close;
    const feeRate = 0.001; // 0.1%

    const bullSignal = ema9 > ema21 && rsi14 > 50 && volume.spike && ob.pressure === 'BUY' && tape.dominance === 'BUY';
    const bearSignal = ema9 < ema21 && rsi14 < 50 && volume.spike && ob.pressure === 'SELL' && tape.dominance === 'SELL';

    let signal = 'NO TRADE';
    if (bullSignal && !bearSignal) signal = 'BUY';
    else if (bearSignal && !bullSignal) signal = 'SELL';

    const mixed =
      (ema9 > ema21 && rsi14 < 50) ||
      (ema9 < ema21 && rsi14 > 50) ||
      ob.pressure === 'NEUTRAL' ||
      (tape.dominance === 'BUY' && ob.pressure === 'SELL') ||
      (tape.dominance === 'SELL' && ob.pressure === 'BUY');

    const stopPctBase = clamp((atr14 / currentPrice) * 100 * 0.8, 0.5, 1.0);

    const stopLoss = signal === 'BUY'
      ? entry * (1 - stopPctBase / 100)
      : signal === 'SELL'
        ? entry * (1 + stopPctBase / 100)
        : entry;

    const tp1 = signal === 'BUY'
      ? entry * 1.005
      : signal === 'SELL'
        ? entry * 0.995
        : entry;

    const tp2 = signal === 'BUY'
      ? entry * 1.01
      : signal === 'SELL'
        ? entry * 0.99
        : entry;

    const tp3 = signal === 'BUY'
      ? entry * 1.02
      : signal === 'SELL'
        ? entry * 0.98
        : entry;

    const leverage = leverageMode === 'manual'
      ? manualLeverage
      : (() => {
          const volatility = atr14 / currentPrice * 100;
          if (trend.marketCondition === 'TRENDING' && volatility < 0.35 && ob.spreadPct !== null && ob.spreadPct < 0.04) return 8;
          if (trend.marketCondition === 'TRENDING' && volatility < 0.55) return 5;
          if (trend.marketCondition === 'SIDEWAYS' && volatility < 0.45) return 3;
          return 2;
        })();

    const infoList = instrumentInfo?.result?.list || [];
    const instrument = infoList[0] || {};
    const priceFilter = instrument.priceFilter || {};
    const lotSize = instrument.lotSizeFilter || {};
    const tickSize = priceFilter.tickSize ? Number(priceFilter.tickSize) : null;
    const stepSize = lotSize.qtyStep ? Number(lotSize.qtyStep) : null;
    const minQty = lotSize.minOrderQty ? Number(lotSize.minOrderQty) : null;

    const riskAmount = capital * (riskPercent / 100);
    const stopDistance = Math.abs(entry - stopLoss);
    let quantity = stopDistance > 0 ? riskAmount / stopDistance : 0;
    const maxNotionalQty = (capital * leverage) / entry;
    quantity = Math.min(quantity, maxNotionalQty);
    if (minQty && quantity < minQty) quantity = minQty;
    if (stepSize) quantity = roundToStep(quantity, stepSize);
    const notional = quantity * entry;

    const roundedEntry = tickSize ? roundToTick(entry, tickSize) : entry;
    const roundedStop = tickSize ? roundToTick(stopLoss, tickSize) : stopLoss;
    const roundedTp1 = tickSize ? roundToTick(tp1, tickSize) : tp1;
    const roundedTp2 = tickSize ? roundToTick(tp2, tickSize) : tp2;
    const roundedTp3 = tickSize ? roundToTick(tp3, tickSize) : tp3;

    const marketStrength = [
      ema9 > ema21 ? 1 : 0,
      rsi14 > 50 ? 1 : 0,
      volume.spike ? 1 : 0,
      ob.pressure === 'BUY' ? 1 : ob.pressure === 'SELL' ? -1 : 0,
      tape.dominance === 'BUY' ? 1 : tape.dominance === 'SELL' ? -1 : 0,
      trend.marketCondition === 'TRENDING' ? 1 : 0,
      macdData && macdData.histogram > 0 ? 1 : macdData && macdData.histogram < 0 ? -1 : 0,
    ].reduce((a, b) => a + b, 0);

    let confidence = 35 + Math.abs(marketStrength) * 8;
    if (signal !== 'NO TRADE') confidence += 12;
    if (volume.spike) confidence += 6;
    if (ob.spreadPct !== null && ob.spreadPct < 0.05) confidence += 4;
    if (signal === 'NO TRADE' && mixed) confidence -= 4;
    confidence = clamp(confidence, 0, 98);

    const reason = buildReason([
      signal === 'BUY' ? 'BUY signal confirmed by EMA9 > EMA21, RSI > 50, volume spike, bid pressure, and buyer-dominant tape.' : null,
      signal === 'SELL' ? 'SELL signal confirmed by EMA9 < EMA21, RSI < 50, volume spike, ask pressure, and seller-dominant tape.' : null,
      signal === 'NO TRADE' ? 'Mixed conditions detected; the setup is not clean enough for a scalping entry.' : null,
      `Spread ${ob.spreadPct !== null ? ob.spreadPct.toFixed(4) + '%' : 'n/a'}; estimated round-trip fee impact ~${(feeRate * 2 * 100).toFixed(2)}%.`,
      `Risk sizing uses ${riskPercent.toFixed(2)}% of ${capital} USDT with leverage ${leverage}x and approximate quantity ${quantity}.`,
      `5m confirmation: ${trend.bullishAlignment ? 'bullish' : trend.bearishAlignment ? 'bearish' : 'neutral'}.`,
      `Bybit market data retrieved from kline, orderbook, recent-trade, and instruments-info endpoints.`,
    ]);

    return json(200, {
      symbol,
      signal,
      confidence,
      entry_price: roundedEntry,
      leverage,
      stop_loss: signal === 'NO TRADE' ? null : roundedStop,
      tp1: signal === 'NO TRADE' ? null : roundedTp1,
      tp2: signal === 'NO TRADE' ? null : roundedTp2,
      tp3: signal === 'NO TRADE' ? null : roundedTp3,
      reason,
      market_condition: trend.marketCondition,
      volume_condition: volume.spike ? 'STRONG' : 'WEAK',
      orderbook_pressure: ob.pressure,
      tape_momentum: tape.dominance,
      risk_reward_ratio: signal !== 'NO TRADE' ? ((Math.abs(roundedTp1 - roundedEntry) / Math.abs(roundedEntry - roundedStop)) || null) : null,
      market_data: {
        current_price: currentPrice,
        last_1m_close: lastCandle.close,
        last_5m_close: candles5m[candles5m.length - 1].close,
        volume_current: volume.current,
        volume_average: volume.average,
        volume_spike: volume.spike,
        volume_trend: volume.trend,
        fee_rate: feeRate,
        fee_estimate_round_trip: Number((entry * quantity * feeRate * 2).toFixed(6)),
        quantity_estimate: quantity,
        notional_estimate: Number(notional.toFixed(6)),
        precision: {
          price_tick: tickSize,
          qty_step: stepSize,
        },
        bybit_symbol_type: category,
      },
      indicators: {
        ema9,
        ema21,
        sma50,
        rsi14,
        macd: macdData,
        bollinger_bands: bb,
        atr14,
        ema_gap_pct: Number((Math.abs(ema9 - ema21) / currentPrice * 100).toFixed(4)),
        atr_pct: Number(((atr14 / currentPrice) * 100).toFixed(4)),
      },
      orderbook: {
        bid_volume: ob.bidVolume,
        ask_volume: ob.askVolume,
        pressure_ratio: ob.pressureRatio,
        pressure: ob.pressure,
        spread: ob.spread,
        spread_pct: ob.spreadPct,
        best_bid: ob.bestBid,
        best_ask: ob.bestAsk,
        bid_wall: ob.bidWall,
        ask_wall: ob.askWall,
      },
      tape: {
        buy_qty: tape.buyQty,
        sell_qty: tape.sellQty,
        buy_count: tape.buyCount,
        sell_count: tape.sellCount,
        dominance: tape.dominance,
        ratio: tape.ratio,
      },
      risk: {
        capital,
        risk_percent: riskPercent,
        risk_amount: Number(riskAmount.toFixed(6)),
        leverage_mode: leverageMode,
        leverage_suggested: leverage,
        stop_pct: stopPctBase,
        fee_rate: feeRate,
      },
      flags: {
        mixed,
        bearishAlignment: trend.bearishAlignment,
        bullishAlignment: trend.bullishAlignment,
      },
    });
  } catch (err) {
    return json(500, {
      error: err?.message || 'Unknown error',
    });
  }
};
