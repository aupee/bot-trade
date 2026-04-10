# PulseScalp Pro

Professional crypto scalping analyzer built with:
- HTML, CSS, Vanilla JavaScript
- Netlify Functions (Node.js)
- Binance public API

## Features
- Landing page + analysis dashboard
- Coin selector
- Capital, risk, and leverage inputs
- On-click analysis only
- EMA 9 / EMA 21 / SMA 50 / RSI / MACD / Bollinger Bands / ATR
- Order book, spread, and tape analysis
- Clean JSON response for frontend rendering

## Deployment
1. Put the files into a Netlify site.
2. Keep the function at `netlify/functions/analyze.js`.
3. Deploy.

## Local run
Use Netlify CLI:
```bash
npm install -g netlify-cli
netlify dev
```
