const form = document.getElementById('analysisForm');
const startBtn = document.getElementById('startBtn');
const loading = document.getElementById('loading');

const state = {
  symbol: document.getElementById('symbol'),
  capital: document.getElementById('capital'),
  riskPercent: document.getElementById('riskPercent'),
  leverageMode: document.getElementById('leverageMode'),
  manualLeverage: document.getElementById('manualLeverage'),
};

const dom = {
  previewSignal: document.getElementById('previewSignal'),
  previewConfidence: document.getElementById('previewConfidence'),
  symbolLabel: document.getElementById('symbolLabel'),
  signalBadge: document.getElementById('signalBadge'),
  confidenceText: document.getElementById('confidenceText'),
  rrText: document.getElementById('rrText'),
  entryPrice: document.getElementById('entryPrice'),
  stopLoss: document.getElementById('stopLoss'),
  tp1: document.getElementById('tp1'),
  tp2: document.getElementById('tp2'),
  tp3: document.getElementById('tp3'),
  leverage: document.getElementById('leverage'),
  marketCondition: document.getElementById('marketCondition'),
  volumeCondition: document.getElementById('volumeCondition'),
  orderbookPressure: document.getElementById('orderbookPressure'),
  tapeMomentum: document.getElementById('tapeMomentum'),
  marketData: document.getElementById('marketData'),
  indicatorData: document.getElementById('indicatorData'),
  orderbookData: document.getElementById('orderbookData'),
  finalReason: document.getElementById('finalReason'),
};

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
const pct = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function setLoading(on) {
  loading.classList.toggle('hidden', !on);
  startBtn.disabled = on;
  startBtn.textContent = on ? 'Analyzing...' : 'Start Analysis';
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return nf.format(num);
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${pct.format(Number(value))}%`;
}

function applySignalClass(el, signal) {
  el.classList.remove('buy', 'sell', 'neutral');
  if (signal === 'BUY') el.classList.add('buy');
  else if (signal === 'SELL') el.classList.add('sell');
  else el.classList.add('neutral');
}

function rrRatio(signal, entry, sl, tp1) {
  if (!entry || !sl || !tp1) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp1 - entry);
  if (!risk) return null;
  return reward / risk;
}

function render(result) {
  dom.symbolLabel.textContent = result.symbol || state.symbol.value;
  dom.signalBadge.textContent = result.signal || 'NO TRADE';
  dom.previewSignal.textContent = result.signal || 'NO TRADE';
  dom.previewConfidence.textContent = `Confidence: ${formatPct(result.confidence)}`;
  applySignalClass(dom.signalBadge, result.signal);
  applySignalClass(dom.previewSignal, result.signal);

  dom.confidenceText.textContent = formatPct(result.confidence);
  dom.rrText.textContent = result.risk_reward_ratio ? `${result.risk_reward_ratio.toFixed(2)}R` : '—';

  dom.entryPrice.textContent = formatNumber(result.entry_price);
  dom.stopLoss.textContent = formatNumber(result.stop_loss);
  dom.tp1.textContent = formatNumber(result.tp1);
  dom.tp2.textContent = formatNumber(result.tp2);
  dom.tp3.textContent = formatNumber(result.tp3);
  dom.leverage.textContent = result.leverage ? `${result.leverage}x` : '—';

  dom.marketCondition.textContent = result.market_condition || '—';
  dom.volumeCondition.textContent = result.volume_condition || '—';
  dom.orderbookPressure.textContent = result.orderbook_pressure || '—';
  dom.tapeMomentum.textContent = result.tape_momentum || '—';

  dom.marketData.textContent = JSON.stringify(result.market_data, null, 2);
  dom.indicatorData.textContent = JSON.stringify(result.indicators, null, 2);
  dom.orderbookData.textContent = JSON.stringify(result.orderbook, null, 2);
  dom.finalReason.textContent = result.reason || 'No reason returned.';
}

function renderError(err) {
  dom.symbolLabel.textContent = state.symbol.value;
  dom.signalBadge.textContent = 'ERROR';
  dom.previewSignal.textContent = 'ERROR';
  applySignalClass(dom.signalBadge, 'NO TRADE');
  applySignalClass(dom.previewSignal, 'NO TRADE');
  dom.confidenceText.textContent = '0%';
  dom.rrText.textContent = '—';
  dom.finalReason.textContent = err.message || 'Request failed';
  dom.marketData.textContent = 'Failed to load market data.';
  dom.indicatorData.textContent = '—';
  dom.orderbookData.textContent = '—';
}

async function analyze() {
  const payload = {
    symbol: state.symbol.value.trim().toUpperCase(),
    capital: Number(state.capital.value),
    riskPercent: Number(state.riskPercent.value),
    leverageMode: state.leverageMode.value,
    leverage: Number(state.manualLeverage.value),
  };

  const res = await fetch('/.netlify/functions/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Backend returned an error');
  }
  return data;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading(true);
  dom.finalReason.textContent = 'Fetching live Binance data...';
  try {
    const result = await analyze();
    render(result);
  } catch (err) {
    console.error(err);
    renderError(err);
  } finally {
    setLoading(false);
  }
});

render({
  signal: 'NO TRADE',
  confidence: 0,
  entry_price: null,
  stop_loss: null,
  tp1: null,
  tp2: null,
  tp3: null,
  leverage: null,
  market_condition: '—',
  volume_condition: '—',
  orderbook_pressure: '—',
  tape_momentum: '—',
  reason: 'Waiting for analysis.',
  market_data: {},
  indicators: {},
  orderbook: {},
});
