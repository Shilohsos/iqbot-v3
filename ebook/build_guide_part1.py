#!/usr/bin/env python3
"""Build the expanded Compounding Guide — Part One: The Foundation."""
import math

def curve(start, daily_pct, days):
    r = 1 + daily_pct / 100.0
    return [round(start * (r ** d), 2) for d in range(days + 1)]

c15, c20, c25 = curve(10,15,21), curve(10,20,21), curve(10,25,21)
c100 = curve(100, 25, 21)   # $100 -> $10k
c1k = curve(1000, 15, 21)   # $1,000 -> $15k

def svg_chart(days, series, width=680, height=300, pad_l=58, pad_b=40, pad_t=16, pad_r=16,
              labels=None, area_fill=False, yfmt=lambda v: f"${v:,.0f}"):
    maxv = max(max(s[1]) for s in series)
    plot_w = width - pad_l - pad_r; plot_h = height - pad_t - pad_b
    def X(d): return pad_l + plot_w * (d / days)
    def Y(v): return pad_t + plot_h * (1 - v / maxv)
    parts = []
    for i in range(5):
        v = maxv * (i / 4); y = Y(v)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{width-pad_r}" y2="{y:.1f}" stroke="#1E1E24" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l-8}" y="{y+4:.1f}" fill="#6A6A70" font-size="9" text-anchor="end">{yfmt(v)}</text>')
    for d in range(0, days + 1, 3):
        parts.append(f'<text x="{X(d):.1f}" y="{height-pad_b+16:.1f}" fill="#6A6A70" font-size="9" text-anchor="middle">Day {d}</text>')
    for (name, data, color, dash) in series:
        pts = " ".join(f"{X(d):.1f},{Y(v):.1f}" for d, v in enumerate(data))
        if area_fill and name == series[-1][0]:
            parts.append(f'<polygon points="{pad_l},{Y(0):.1f} {pts} {X(days):.1f},{Y(0):.1f}" fill="rgba(245,184,0,0.08)"/>')
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.5" stroke-dasharray="{dash}" stroke-linecap="round"/>')
        parts.append(f'<text x="{X(days)-4:.1f}" y="{Y(data[-1])+4:.1f}" fill="{color}" font-size="9.5" text-anchor="end" font-weight="700">{name}</text>')
    if labels:
        for (d, v, txt) in labels:
            parts.append(f'<circle cx="{X(d):.1f}" cy="{Y(v):.1f}" r="4" fill="#FFFFFF" stroke="#F5B800" stroke-width="2"/>')
            parts.append(f'<text x="{X(d):.1f}" y="{Y(v)-10:.1f}" fill="#FFFFFF" font-size="9.5" text-anchor="middle" font-weight="700">{txt}</text>')
    return f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#0F0F13;border-radius:3mm;">{"".join(parts)}</svg>'

chart1 = svg_chart(21, [("+15%/day", c15, "#8A8A8F", "4 4"), ("+20%/day", c20, "#E8E6E0", "4 4"), ("+25%/day", c25, "#F5B800", "none")])
chart2 = svg_chart(21, [("Your account", c25, "#F5B800", "none")], area_fill=True,
                   labels=[(0,10,"$10"),(7,c25[7],"$48"),(14,c25[14],"$227"),(21,c25[21],"$1,000+")])
chart3 = svg_chart(21, [("Your account", c100, "#F5B800", "none")], area_fill=True,
                   labels=[(0,100,"$100"),(7,c100[7],"$477"),(14,c100[14],"$2,274"),(21,c100[21],"$10,000+")])
chart4 = svg_chart(21, [("Your account", c1k, "#F5B800", "none")], area_fill=True,
                   labels=[(0,1000,"$1,000"),(7,c1k[7],"$2,660"),(14,c1k[14],"$7,076"),(21,c1k[21],"$15,000+")])

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Compounding with 10x AI — Part One: The Foundation</title>
<style>
  @page {{ size: A4; margin: 0; }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background: #0A0A0D; color: #E8E6E0; }}
  .page {{ width: 210mm; height: 297mm; page-break-after: always; position: relative; overflow: hidden; }}
  .page:last-child {{ page-break-after: auto; }}
  .cover {{ display: flex; flex-direction: column; justify-content: center; padding: 30mm 22mm; }}
  .cover .wordmark {{ font-size: 11pt; letter-spacing: 6px; color: #F5B800; font-weight: 700; margin-bottom: 26mm; }}
  .cover .part {{ font-size: 10pt; letter-spacing: 5px; color: #8A8A8F; margin-bottom: 6mm; }}
  .cover h1 {{ font-family: Georgia, serif; font-size: 38pt; line-height: 1.15; color: #FFFFFF; }}
  .cover h1 .gold {{ color: #F5B800; }}
  .cover .sub {{ margin-top: 10mm; font-size: 12.5pt; color: #8A8A8F; line-height: 1.9; }}
  .cover .rule {{ width: 34mm; height: 2px; background: #F5B800; margin-top: 12mm; }}
  .cover .foot {{ position: absolute; bottom: 18mm; left: 22mm; font-size: 9pt; color: #5A5A60; letter-spacing: 4px; }}
  .content {{ padding: 18mm 17mm; }}
  .content h2 {{ font-family: Georgia, serif; font-size: 19pt; color: #F5B800; margin-bottom: 4.5mm; }}
  .content h3 {{ font-size: 12pt; color: #FFFFFF; margin: 5mm 0 2.5mm; }}
  .content p {{ font-size: 10.5pt; line-height: 1.68; color: #C9C7C0; margin-bottom: 3mm; }}
  .content ul {{ margin: 0 0 4mm 6mm; }}
  .content li {{ font-size: 10.5pt; line-height: 1.6; color: #C9C7C0; margin-bottom: 2mm; }}
  .content .gold {{ color: #F5B800; font-weight: 700; }}
  .content .card {{ border: 1px solid rgba(245,184,0,0.4); border-radius: 3mm; padding: 5.5mm 6.5mm; margin: 4.5mm 0; }}
  .content .card h4 {{ color: #F5B800; font-size: 11pt; letter-spacing: 2px; margin-bottom: 2.5mm; }}
  table {{ width: 100%; border-collapse: collapse; margin: 4.5mm 0; font-size: 9.5pt; }}
  th {{ color: #F5B800; text-align: left; padding: 2.8mm 2.5mm; border-bottom: 1px solid rgba(245,184,0,0.5); letter-spacing: 1px; }}
  td {{ padding: 2.6mm 2.5mm; border-bottom: 1px solid #232329; color: #C9C7C0; }}
  .chart {{ margin: 4.5mm 0; }}
  .step {{ display: flex; gap: 5mm; margin-bottom: 3mm; }}
  .step .n {{ font-family: Georgia, serif; font-size: 14pt; color: #F5B800; min-width: 9mm; }}
  .step .t p {{ margin-bottom: 1.2mm; }}
  .footnote {{ font-size: 8.5pt; color: #6A6A70; line-height: 1.6; margin-top: 4mm; border-top: 1px solid #232329; padding-top: 3mm; }}
  .quote {{ border-left: 2px solid #F5B800; padding: 3.5mm 5mm; margin: 4.5mm 0; font-style: italic; color: #E8E6E0; font-size: 11pt; }}
  .big {{ font-family: Georgia, serif; font-size: 25pt; color: #F5B800; text-align: center; margin: 5mm 0; }}
</style>
</head>
<body>

<!-- COVER -->
<div class="page cover">
  <div class="wordmark">10X AI</div>
  <div class="part">PART ONE · THE FOUNDATION</div>
  <h1>Compounding<br>with <span class="gold">10x AI</span></h1>
  <div class="rule"></div>
  <div class="sub">THE GUIDE · SMALL CAPITAL &amp; BIG CAPITAL<br>Turn what you have into what you want</div>
  <div class="foot">· BY 10X AI ·</div>
</div>

<!-- CONTENTS -->
<div class="page content">
  <h2>What is inside</h2>
  <table>
    <tr><th>Chapter</th><th>What you will learn</th></tr>
    <tr><td>1 · What compounding is</td><td>The snowball effect and why it beats big bets</td></tr>
    <tr><td>2 · The mechanics on IQ Option</td><td>Payouts, stakes, Higher/Lower — the engine room</td></tr>
    <tr><td>3 · The formula and the curves</td><td>The math that turns $10 into $1,000+</td></tr>
    <tr><td>4 · The four steps of the method</td><td>The exact routine every cycle follows</td></tr>
    <tr><td>5 · Small capital playbook</td><td>$10, $50, $500 — full daily routine and milestones</td></tr>
    <tr><td>6 · Big capital playbook</td><td>$1,000 and above — protection first, growth always</td></tr>
    <tr><td>7 · The cycle</td><td>Duration, the goal, and the two rules that protect it</td></tr>
    <tr><td>8 · What breaks the cycle</td><td>The mistakes that kill accounts — and how to avoid them</td></tr>
    <tr><td>9 · Your checklist and FAQ</td><td>The weekly routine and the questions everyone asks</td></tr>
  </table>
  <p class="footnote">Part Two of this guide — advanced stake management and multi-pair compounding — is coming soon.</p>
</div>

<!-- 1. WHAT COMPOUNDING IS -->
<div class="page content">
  <h2>1 · What compounding is</h2>
  <p>Compounding is the snowball effect, applied to money. <span class="gold">Your profits stay in the account, and every next trade is sized off the new, larger balance.</span> You are not chasing big wins — you are letting steady growth build on itself, day after day.</p>
  <p>A snowball starts small. Roll it once and it picks up a little snow. Roll it again and it picks up more, because the ball itself is bigger. That is exactly how a compounded account behaves: the first week looks small, the third week looks different, and by the end of the cycle the growth is happening faster than anyone expected.</p>
  <div class="quote">"Most traders lose the same way: they risk too much, lose it, then chase the loss with a bigger bet. Compounding is the opposite — small, consistent, and relentless."</div>
  <h3>Why compounding beats big bets</h3>
  <p>A single big trade can win — or it can wipe out a week of progress in one candle. A compounded account never depends on a single moment. It depends on <span class="gold">time in the market with the winnings in play.</span> That is why the method matters more than the market: the market moves every day, but only the compounding account turns those moves into permanent growth.</p>
  <p class="footnote">Nothing is guaranteed and no system is perfect — this guide gives growth its best chance, it does not remove risk from trading.</p>
</div>

<!-- 2. MECHANICS -->
<div class="page content">
  <h2>2 · The mechanics on IQ Option</h2>
  <p>You trade OTC pairs — EURUSD-OTC, GBPUSD-OTC, AUDUSD-OTC and the rest — on short timeframes. Every trade is a binary option: you predict whether the price finishes <span class="gold">above (Higher / BUY)</span> or <span class="gold">below (Lower / SELL)</span> when the timer expires.</p>
  <h3>The payout</h3>
  <p>OTC pairs pay roughly <span class="gold">86%</span> on a winning trade. Stake $100, win, and you receive your $100 back plus $86 profit. Lose, and you lose the stake. That asymmetry — 86% for a win, 100% for a loss — is why stake size is the trader's real edge: it decides how much a streak of wins grows the account and how much a streak of losses shrinks it.</p>
  <h3>Two numbers decide everything</h3>
  <table>
    <tr><th>Number</th><th>Who owns it</th><th>Why it matters</th></tr>
    <tr><td>Win rate</td><td>The engine (10x AI)</td><td>How often the direction is right</td></tr>
    <tr><td>Stake size</td><td>You</td><td>The % of balance per trade — the growth dial</td></tr>
  </table>
  <div class="card">
    <h4>WHY STAKE SIZE MATTERS MORE THAN WIN RATE</h4>
    <p>At 86% payout and a 60% win rate, a 2% stake nets roughly +0.23% per trade on average. A 10% stake with the same win rate nets +1.16% per trade — but one losing streak of four trades costs −34% of the account. <span class="gold">Small stakes survive the streaks; large stakes die before the streak ends.</span></p>
  </div>
  <p class="footnote">The engine finds the direction. The method decides the stake. Together they compound.</p>
</div>

<!-- 3. THE FORMULA AND CURVES -->
<div class="page content">
  <h2>3 · The formula and the curves</h2>
  <p>This is the engine room of the whole idea:</p>
  <div class="card">
    <h4>THE COMPOUND FORMULA</h4>
    <p>Balance after N days = Start × (1 + daily growth)<sup>N</sup></p>
    <p>$10 at +25% a day → 10 × 1.25<sup>21</sup> = <span class="gold">$1,084</span><br>
       $100 at +25% a day → 100 × 1.25<sup>21</sup> = <span class="gold">$10,843</span><br>
       $1,000 at +15% a day → 1,000 × 1.15<sup>21</sup> = <span class="gold">$15,289</span></p>
  </div>
  <p>Notice the pattern: the same curve that turns $10 into $1,000 turns $100 into $10,000. <span class="gold">The size of the start changes, the shape of the journey does not.</span></p>
  <div class="chart">{chart1}</div>
  <p class="footnote">Three compounding curves from $10 over a 21-day cycle. The difference between +15% and +25% a day is the difference between patience and a goal.</p>
</div>

<!-- 4. THE FOUR STEPS -->
<div class="page content">
  <h2>4 · The four steps of the method</h2>
  <p>Every cycle — small or big — runs the same four steps. This is the routine. Nothing else is required.</p>
  <div class="card">
    <h4>STEP 1 — SECURE CAPITAL</h4>
    <p>Fund the account with money that stays untouched for the cycle. It is not spending money; it is working capital with a job to do.</p>
  </div>
  <div class="card">
    <h4>STEP 2 — TRADE ONLY THE PROFIT</h4>
    <p>The base stays protected. Only the profit the engine generates is used to take the next trade. The base never shrinks; it only ever grows.</p>
  </div>
  <div class="card">
    <h4>STEP 3 — FIXED DURATION</h4>
    <p>Choose the cycle length up front — two weeks or three. No early exits, no skipped days, no changing the rules halfway. The engine runs the same schedule every day.</p>
  </div>
  <div class="card">
    <h4>STEP 4 — NO WITHDRAWALS</h4>
    <p>The compound is the whole point. Nothing leaves the account until the goal lands. Withdrawals are the end-of-cycle reward, not a mid-cycle habit.</p>
  </div>
  <div class="quote">"The engine handles the analysis. You handle the patience. That is the entire division of labour."</div>
</div>

<!-- 5. SMALL CAPITAL -->
<div class="page content">
  <h2>5 · Small capital playbook — $10, $50, $500</h2>
  <p>Small capital is the best place to start, because the method is identical at every size — and the account gets to prove itself while the risk is tiny. <span class="gold">Small accounts are not small opportunities; they are the same curve, starting lower.</span></p>
  <h3>Your setup</h3>
  <ul>
    <li>Product: <span class="gold">Private Trader</span> (guided) or <span class="gold">Autopilot</span> (automated)</li>
    <li>Pair: one liquid OTC pair you stay with (EURUSD-OTC is the default)</li>
    <li>Timeframe: 1m or 2m — short enough to compound daily</li>
    <li>Stake: <span class="gold">1–2% of the balance</span>, recalculated every day</li>
    <li>Daily loss stop: <span class="gold">−8%</span> — the day ends there, the cycle continues tomorrow</li>
  </ul>
  <h3>The daily routine</h3>
  <div class="step"><div class="n">1</div><div class="t"><p><span class="gold">Check the balance.</span> The stake is 2% of whatever it is today — not what it was last week.</p></div></div>
  <div class="step"><div class="n">2</div><div class="t"><p><span class="gold">Trade the engine's setups.</span> Recommended asset and timeframe, or let Autopilot run the session.</p></div></div>
  <div class="step"><div class="n">3</div><div class="t"><p><span class="gold">Stop at the daily limit.</span> −8% means the session is over. Tomorrow is another session.</p></div></div>
  <div class="step"><div class="n">4</div><div class="t"><p><span class="gold">Reinvest every win.</span> Profit stays in; the next stake is 2% of the new balance.</p></div></div>
  <p class="footnote">The routine is the strategy. Skip a day and the curve skips with it.</p>
</div>

<!-- 5b. THE $10 JOURNEY -->
<div class="page content">
  <h2>5 · The $10 journey</h2>
  <p>This is the journey the guide keeps returning to, because it proves the point: <span class="gold">the start size is not the ceiling.</span> A $10 account following the routine:</p>
  <div class="chart">{chart2}</div>
  <table>
    <tr><th>Day</th><th>Account</th><th>Milestone</th></tr>
    <tr><td>0</td><td>$10</td><td>The start — one funded account</td></tr>
    <tr><td>7</td><td>$48</td><td>Almost 5x in one week</td></tr>
    <tr><td>14</td><td>$227</td><td>20x — the curve is alive</td></tr>
    <tr><td>21</td><td>$1,084</td><td>100x — the goal lands</td></tr>
  </table>
  <div class="card">
    <h4>THE SAME CURVE, BIGGER START</h4>
    <table>
      <tr><th>Start</th><th>+25%/day, 21 days</th><th>The milestone</th></tr>
      <tr><td>$10</td><td>$1,084</td><td>Your first $1,000</td></tr>
      <tr><td>$50</td><td>$5,421</td><td>Your first $5,000</td></tr>
      <tr><td>$100</td><td>$10,843</td><td>Your first $10,000</td></tr>
      <tr><td>$500</td><td>$54,215</td><td>A serious account</td></tr>
    </table>
  </div>
  <p class="footnote">Illustrative compounding paths at consistent daily growth with the engine's setups — the shape of the curve, not a promise of any specific result.</p>
</div>

<!-- 5c. THE $100 JOURNEY -->
<div class="page content">
  <h2>5 · The $100 journey — the first $10,000</h2>
  <p>$100 is the most common starting point, and it is the one the curve rewards most visibly. Follow the routine, protect the base, and the milestones come in order:</p>
  <div class="chart">{chart3}</div>
  <table>
    <tr><th>Week</th><th>Account</th><th>What happened</th></tr>
    <tr><td>Week 1</td><td>$477</td><td>The base is protected, the winnings are compounding</td></tr>
    <tr><td>Week 2</td><td>$2,274</td><td>The curve is visibly alive — 20x territory</td></tr>
    <tr><td>Week 3</td><td>$10,843</td><td>The goal: your first $10,000 account</td></tr>
  </table>
  <div class="quote">"Nobody looks at a $100 account and imagines $10,000. That is exactly why the curve works — it does not need anyone to believe it."</div>
  <p class="footnote">Illustrative compounding path. Some weeks run ahead of the curve, some behind — the method absorbs both.</p>
</div>

<!-- 6. BIG CAPITAL -->
<div class="page content">
  <h2>6 · Big capital playbook — $1,000 and above</h2>
  <p>Big capital has a different job: <span class="gold">protect the base, grow it steadily, and let time make it serious.</span> Speed is not the point — a 5–8% weekly routine on $5,000 is already $250–$400 a week, compounding while you live your life.</p>
  <h3>Your setup</h3>
  <ul>
    <li>Product: <span class="gold">Autopilot</span> as the base; Private Trader for your own sessions</li>
    <li>Pairs: 2–3 OTC pairs — spread the engine's reads, never one basket</li>
    <li>Timeframe: 1m / 2m / 5m mix</li>
    <li>Stake: <span class="gold">0.5–1% of the balance</span> per trade</li>
    <li>Daily loss stop: <span class="gold">−5%</span>, hard</li>
  </ul>
  <h3>The differences from small capital</h3>
  <ul>
    <li>You <span class="gold">spread across pairs</span> — one pair's bad session does not touch the others</li>
    <li>You <span class="gold">withdraw only the excess</span> above your base once the cycle ends — the base always stays</li>
    <li>You <span class="gold">never raise the stake to recover</span> — at this size, recovery attempts are how accounts die</li>
  </ul>
  <div class="chart">{chart4}</div>
  <table>
    <tr><th>Week</th><th>$1,000 account</th><th>$5,000 account</th></tr>
    <tr><td>0</td><td>$1,000</td><td>$5,000</td></tr>
    <tr><td>1</td><td>$2,660</td><td>$13,300</td></tr>
    <tr><td>2</td><td>$7,076</td><td>$35,380</td></tr>
    <tr><td>3</td><td>$15,289</td><td>$76,445</td></tr>
  </table>
  <p class="footnote">Illustrative compounding paths. The base stays protected; the curve does the rest.</p>
</div>

<!-- 7. THE CYCLE -->
<div class="page content">
  <h2>7 · The cycle — two or three weeks, one goal</h2>
  <p>Every compounding run is a <span class="gold">cycle with a duration and a goal</span>. Two weeks or three — you choose at the start, and the cycle runs until the goal lands. A goal without a date is a wish; a goal with a date is a plan.</p>
  <div class="big">The goal is the finish line.</div>
  <div class="card">
    <h4>RULE 1 — NO WITHDRAWALS UNTIL THE GOAL IS MET</h4>
    <p>The compound works because the money stays in play. Every dollar withdrawn mid-cycle is a dollar that stops growing — and a little bit of the curve that never happens. <span class="gold">Nothing leaves the treasury until the goal lands.</span> That is the deal you make with yourself on day one.</p>
  </div>
  <div class="card">
    <h4>RULE 2 — FALL SHORT? TOP UP AND CONTINUE</h4>
    <p>Some weeks are lighter than others — that is trading, not failure. If the cycle is running behind, the best move is not to abandon it: <span class="gold">top up the account and keep the goal alive.</span> The engine keeps trading, the method keeps compounding, and the cycle finishes — the same goal, the same rules, just more runway.</p>
  </div>
  <div class="card">
    <h4>RULE 3 — THE BASE NEVER RISKS MORE THAN THE RULE</h4>
    <p>Stake percentage is fixed. The loss stop is fixed. The duration is fixed. Only the balance is allowed to grow.</p>
  </div>
  <p class="footnote">Three rules. They fit on one line and they carry the entire method.</p>
</div>

<!-- 8. MISTAKES -->
<div class="page content">
  <h2>8 · What breaks the cycle</h2>
  <p>Every account that died did so through one of these. Read them until they are boring — boring is safe.</p>
  <ul>
    <li><span class="gold">Withdrawing early.</span> The fastest way to kill a compounding run. The goal is not met until the cycle says so.</li>
    <li><span class="gold">Raising the stake because you feel hot.</span> The stake rises with the balance — never with emotion. Feeling hot is not a strategy.</li>
    <li><span class="gold">Chasing a red day.</span> The daily loss stop exists so one bad day cannot become a bad month.</li>
    <li><span class="gold">Doubling to recover.</span> One lost trade is one lost trade. Recovery with size is how accounts die in a single afternoon.</li>
    <li><span class="gold">Quitting the cycle at week one.</span> The first week is the smallest week. The curve does the work later.</li>
    <li><span class="gold">Trading every signal.</span> More trades is not more profit. The loss stop protects you from yourself.</li>
    <li><span class="gold">Forgetting the goal.</span> Write it down. $10 → $1,000. $100 → $10,000. It is the reason the rules exist.</li>
  </ul>
  <div class="quote">"The account that stays in the cycle is the account that compounds. Everything else is noise."</div>
</div>

<!-- 9. CHECKLIST + FAQ -->
<div class="page content">
  <h2>9 · Your cycle checklist</h2>
  <table>
    <tr><th>When</th><th>Action</th></tr>
    <tr><td>Day 1</td><td>Set the goal and the duration (2 or 3 weeks). Fund the account. Stake = rule%.</td></tr>
    <tr><td>Daily</td><td>Engine setups → stake off the current balance → stop at the daily loss limit.</td></tr>
    <tr><td>Weekly</td><td>Log the week: wins, losses, net %. Recalculate the stake on the new balance.</td></tr>
    <tr><td>Goal not met</td><td>Top up, keep the cycle running, continue compounding.</td></tr>
    <tr><td>Goal met</td><td>Withdraw the growth. Start the next cycle from the new base.</td></tr>
  </table>
  <h2>9 · Quick answers</h2>
  <h3>Can I compound with $10?</h3>
  <p>Yes — and it is the most honest way to learn the method. The stake is tiny, the risk is tiny, and the curve is identical to the one a $500 account follows. Protect the account and the percentages do the work.</p>
  <h3>What if I have a red week?</h3>
  <p>You stop at the daily loss stop, log it, and continue next week from the new balance. The stake recalibrates automatically because it is a percentage.</p>
  <h3>Autopilot or Private Trader?</h3>
  <p>Autopilot compounds while you are away — best for big capital consistency. Private Trader builds the discipline — best for small capital learning the method. Most serious compounders run both.</p>
  <h3>How long is a cycle?</h3>
  <p>Two weeks or three — you choose on day one. The cycle ends when the goal lands, and the new cycle starts from the new base.</p>
  <h3>Is this guaranteed?</h3>
  <p>No. Nothing is guaranteed, and no system is perfect. This guide reduces the risk of losing your base and gives growth its fair chance — it does not remove risk from trading.</p>
  <p class="footnote">Part Two — advanced stake management and multi-pair compounding — is coming soon. · BY 10X AI</p>
</div>

</body>
</html>
"""

with open("/root/iqbot-v3/ebook/guide-compounding-part1.html", "w") as f:
    f.write(HTML)
print("written guide-compounding-part1.html")
