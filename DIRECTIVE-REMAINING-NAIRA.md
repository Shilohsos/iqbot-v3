# DIRECTIVE: Fix remaining ₦ in results/ticker + remove bar chart

**IMPORTANT:** This edits `/var/www/10xbot/funnel/index.html` directly (no build needed).

## Fix 1: Results data and render — ₦ → $

In the `<script>` section, the results array and render function still use ₦:

**A)** Replace the results array values (divide by 100 for USD):
```
  { pair: 'EUR/USD (OTC)', type: 'Blitz', stake: 1000, profit: 1870 },
  { pair: 'EUR/USD (OTC)', type: 'Blitz', stake: 2000, profit: 3740 },
  ...
```
→
```
  { pair: 'EUR/USD (OTC)', type: 'Blitz', stake: 10, profit: 18.70 },
  { pair: 'EUR/USD (OTC)', type: 'Blitz', stake: 20, profit: 37.40 },
  ...
```

**B)** Replace the render function ₦ to $:
```
'<div class="result-stake">₦' + r.stake.toLocaleString() + '</div>' +
'<div class="result-profit">+₦' + r.profit.toLocaleString() + '</div>' +
```
→
```
'<div class="result-stake">$' + r.stake.toFixed(2) + '</div>' +
'<div class="result-profit">+$' + r.profit.toFixed(2) + '</div>' +
```

**C)** Also check the `toLocaleString()` → should use `toFixed(2)` for USD decimals.

## Fix 2: Ticker ₦ → $

In the ticker builder:
```
'<span class="amount">+₦' + tickerProfits[idx].toLocaleString() + '</span>' +
```
→
```
'<span class="amount">+$' + (tickerProfits[idx] / 100).toFixed(2) + '</span>' +
```

Also divide ticker profits by 100:
```
var tickerProfits = [1870, 3740, 1850, ...];
```
→
```
var tickerProfits = [18.70, 37.40, 18.50, ...];
```

## Fix 3: Remove the bar chart graphic

In the hero section, remove the entire `.hero-card` div:

Find and delete everything from `<div class="hero-card">` to its closing `</div>` (the bar chart with purple/green bars and the 95% win rate / 8 OTC Pairs / 24/7 Auto Trading stats).

OR — if the stats (95% win rate etc.) should stay but the visual chart bars go: keep the stats row, remove only the `.chart-area` div within hero-card.

User specifically wants that graphic gone. Decide which makes the page look better.

## Verification
- [ ] Results section shows $ not ₦
- [ ] Ticker shows $ not ₦
- [ ] Bar chart removed (or only the visual chart bars removed, stats kept)
- [ ] Values display with 2 decimal places (e.g. $18.70 not $1870)
