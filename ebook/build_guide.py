#!/usr/bin/env python3
"""Build the full Compounding Guide HTML with embedded SVG charts."""
import math

def curve(start, daily_pct, days):
    r = 1 + daily_pct / 100.0
    return [round(start * (r ** d), 2) for d in range(days + 1)]

c15, c20, c25 = curve(10,15,21), curve(10,20,21), curve(10,25,21)
c8 = curve(1000, 8, 21)

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
chart3 = svg_chart(21, [("+8%/day", c8, "#F5B800", "none")], area_fill=True,
                   labels=[(0,1000,"$1,000"),(21,c8[21],"$5,000+")])

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Compounding with 10x AI — The Guide</title>
<style>
  @page {{ size: A4; margin: 0; }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background: #0A0A0D; color: #E8E6E0; }}
  .page {{ width: 210mm; height: 297mm; page-break-after: always; position: relative; overflow: hidden; }}
  .page:last-child {{ page-break-after: auto; }}
  .cover {{ display: flex; flex-direction: column; justify-content: center; padding: 30mm 22mm; }}
  .cover .wordmark {{ font-size: 11pt; letter-spacing: 6px; color: #F5B800; font-weight: 700; margin-bottom: 24mm; }}
  .cover h1 {{ font-family: Georgia, serif; font-size: 40pt; line-height: 1.15; color: #FFFFFF; }}
  .cover h1 .gold {{ color: #F5B800; }}
  .cover .sub {{ margin-top: 10mm; font-size: 12.5pt; color: #8A8A8F; line-height: 1.9; }}
  .cover .rule {{ width: 34mm; height: 2px; background: #F5B800; margin-top: 12mm; }}
  .cover .foot {{ position: absolute; bottom: 18mm; left: 22mm; font-size: 9pt; color: #5A5A60; letter-spacing: 4px; }}
  .content {{ padding: 20mm 18mm; }}
  .content h2 {{ font-family: Georgia, serif; font-size: 20pt; color: #F5B800; margin-bottom: 5mm; }}
  .content h3 {{ font-size: 12.5pt; color: #FFFFFF; margin: 5mm 0 2.5mm; }}
  .content p {{ font-size: 10.5pt; line-height: 1.7; color: #C9C7C0; margin-bottom: 3mm; }}
  .content ul {{ margin: 0 0 4mm 6mm; }}
  .content li {{ font-size: 10.5pt; line-height: 1.65; color: #C9C7C0; margin-bottom: 2mm; }}
  .content .gold {{ color: #F5B800; font-weight: 700; }}
  .content .card {{ border: 1px solid rgba(245,184,0,0.4); border-radius: 3mm; padding: 6mm 7mm; margin: 5mm 0; }}
  .content .card h4 {{ color: #F5B800; font-size: 11pt; letter-spacing: 2px; margin-bottom: 2.5mm; }}
  table {{ width: 100%; border-collapse: collapse; margin: 5mm 0; font-size: 9.5pt; }}
  th {{ color: #F5B800; text-align: left; padding: 3mm 2.5mm; border-bottom: 1px solid rgba(245,184,0,0.5); letter-spacing: 1px; }}
  td {{ padding: 2.8mm 2.5mm; border-bottom: 1px solid #232329; color: #C9C7C0; }}
  .chart {{ margin: 5mm 0; }}
  .step {{ display: flex; gap: 5mm; margin-bottom: 3.5mm; }}
  .step .n {{ font-family: Georgia, serif; font-size: 15pt; color: #F5B800; min-width: 9mm; }}
  .step .t p {{ margin-bottom: 1.5mm; }}
  .footnote {{ font-size: 8.5pt; color: #6A6A70; line-height: 1.6; margin-top: 4mm; border-top: 1px solid #232329; padding-top: 3mm; }}
  .quote {{ border-left: 2px solid #F5B800; padding: 3.5mm 5mm; margin: 5mm 0; font-style: italic; color: #E8E6E0; font-size: 11pt; }}
  .big {{ font-family: Georgia, serif; font-size: 26pt; color: #F5B800; text-align: center; margin: 6mm 0; }}
</style>
</head>
<body>

<!-- COVER -->
<div class="page cover">
  <div class="wordmark">10X AI</div>
  <h1>Compounding<br>with <span class="gold">10x AI</span></h1>
  <div class="rule"></div>
  <div class="sub">THE GUIDE · SMALL CAPITAL &amp; BIG CAPITAL<br>Turn what you have into what you want</div>
  <div class="foot">· BY 10X AI ·</div>
</div>

<!-- WHAT COMPOUNDING IS -->
<div class="page content">
  <h2>What compounding is</h2>
  <p>Compounding is simple: <span class="gold">your profits stay in the account</span>, and every next trade is sized off the new, larger balance. You are not chasing big wins — you are letting steady growth build on itself.</p>
  <p>The first week looks small. The third week looks different. That is the whole point.</p>
  <div class="card">
    <h4>THE FORMULA</h4>
    <p>Balance after N days = Start × (1 + daily growth)<sup>N</sup></p>
    <p>$10 at +25% a day → 10 × 1.25<sup>21</sup> = <span class="gold">$1,084</span><br>
       $500 at +20% a day → 500 × 1.2<sup>21</sup> = <span class="gold">$23,000</span><br>
       $1,000 at +8% a day → 1,000 × 1.08<sup>21</sup> = <span class="gold">$5,034</span></p>
  </div>
  <p>These are the curves the engine runs on. The market moves every day — <span class="gold">the compounding is what turns movement into growth.</span></p>
  <div class="chart">{chart1}</div>
  <p class="footnote">Compounding curves for a $10 account over a 21-day cycle. The difference between +15% and +25% a day is the difference between patience and a goal.</p>
</div>

<!-- SMALL CAPITAL -->
<div class="page content">
  <h2>Small capital — start with $10, $50, or $500</h2>
  <p>Small capital is the best place to start, because the method is the same at every size — and the account gets to <span class="gold">prove itself while the risk is tiny.</span></p>
  <h3>The plan</h3>
  <ul>
    <li>Stake: <span class="gold">1–2% of the balance</span> per trade, recalculated daily</li>
    <li>Timeframe: 1m / 2m OTC — the engine's daily rhythm</li>
    <li>Daily loss stop: <span class="gold">−8%</span>. The day ends there. The cycle continues tomorrow.</li>
  </ul>
  <h3>The $10 journey</h3>
  <div class="chart">{chart2}</div>
  <table>
    <tr><th>Day</th><th>Account</th><th>Milestone</th></tr>
    <tr><td>0</td><td>$10</td><td>The start</td></tr>
    <tr><td>7</td><td>$48</td><td>Almost 5x</td></tr>
    <tr><td>14</td><td>$227</td><td>20x — the curve is alive</td></tr>
    <tr><td>21</td><td>$1,084</td><td>100x — goal met</td></tr>
  </table>
  <p class="footnote">Illustrative compounding path — consistent daily growth with the engine's setups. Not a guarantee; every day the engine trades, the balance decides the next stake.</p>
</div>

<!-- BIG CAPITAL -->
<div class="page content">
  <h2>Big capital — $1,000 and above</h2>
  <p>Big capital has a different job: <span class="gold">protect the base, grow it steadily, and let time make it serious.</span> Speed is not the point — a 5–8% weekly routine on $5,000 is already $250–$400 a week, compounding.</p>
  <h3>The plan</h3>
  <ul>
    <li>Stake: <span class="gold">0.5–1% of the balance</span> per trade</li>
    <li>Pairs: 2–3 OTC pairs — spread the engine's reads</li>
    <li>Daily loss stop: <span class="gold">−5%</span>, hard</li>
    <li>Withdrawals: <span class="gold">only after the goal</span> — the base never leaves the account mid-cycle</li>
  </ul>
  <div class="chart">{chart3}</div>
  <table>
    <tr><th>Week</th><th>$1,000 account</th><th>$5,000 account</th></tr>
    <tr><td>0</td><td>$1,000</td><td>$5,000</td></tr>
    <tr><td>1</td><td>$1,398</td><td>$6,988</td></tr>
    <tr><td>2</td><td>$1,953</td><td>$9,767</td></tr>
    <tr><td>3</td><td>$2,730</td><td>$13,650</td></tr>
  </table>
  <p class="footnote">Illustrative — the compounding path at a steady daily rate. The engine does the entries; the plan does the protection.</p>
</div>

<!-- THE CYCLE -->
<div class="page content">
  <h2>The cycle — 3 weeks, one goal</h2>
  <p>Every compounding run is a <span class="gold">cycle with a duration and a goal</span>. Two weeks or three — you choose at the start, and the cycle runs until the goal is met.</p>
  <div class="big">The goal is the finish line.</div>
  <div class="card">
    <h4>RULE 1 — NO WITHDRAWALS UNTIL THE GOAL IS MET</h4>
    <p>The compound works because the money stays in play. Every dollar you withdraw mid-cycle is a dollar that stops growing. <span class="gold">Nothing leaves the account until the goal lands.</span> That is the deal you make with yourself on day one.</p>
  </div>
  <div class="card">
    <h4>RULE 2 — FALL SHORT? TOP UP AND CONTINUE</h4>
    <p>Some weeks are lighter than others — that is trading. If the cycle is running behind, the best move is not to abandon it: <span class="gold">top up the account and keep the goal alive.</span> The engine keeps trading, the plan keeps compounding, and the cycle finishes.</p>
  </div>
  <div class="card">
    <h4>RULE 3 — THE BASE NEVER RISKS MORE THAN THE RULE</h4>
    <p>Stake % is fixed. Loss stop is fixed. Duration is fixed. Only the balance grows.</p>
  </div>
</div>

<!-- MISTAKES -->
<div class="page content">
  <h2>What breaks the cycle</h2>
  <ul>
    <li><span class="gold">Withdrawing early.</span> The single fastest way to kill a compounding run. The goal is not met until the cycle says so.</li>
    <li><span class="gold">Raising the stake because you feel hot.</span> The stake rises with the balance — never with emotion.</li>
    <li><span class="gold">Chasing a red day.</span> The daily loss stop exists so one bad day cannot become a bad month.</li>
    <li><span class="gold">Quitting the cycle at week one.</span> The first week is the smallest week. The curve does the work later.</li>
    <li><span class="gold">Forgetting the goal.</span> Write it down. $10 → $1,000. $500 → $5,000. It is the reason the rules exist.</li>
  </ul>
  <div class="quote">"The account that stays in the cycle is the account that compounds. Everything else is noise."</div>
</div>

<!-- ROUTINE + CLOSE -->
<div class="page content">
  <h2>Your cycle checklist</h2>
  <table>
    <tr><th>When</th><th>Action</th></tr>
    <tr><td>Day 1</td><td>Set the goal and the duration (2 or 3 weeks). Fund the account. Stake = rule%.</td></tr>
    <tr><td>Daily</td><td>Engine setups → stake off current balance → stop at the daily loss limit.</td></tr>
    <tr><td>Weekly</td><td>Log the week. Recalculate the stake on the new balance. Keep the rules.</td></tr>
    <tr><td>Goal not met</td><td>Top up, keep the cycle running, continue compounding.</td></tr>
    <tr><td>Goal met</td><td>Withdraw the growth. Start the next cycle from the new base.</td></tr>
  </table>
  <div class="card">
    <h4>START YOUR CYCLE</h4>
    <p>1. Create your account — <span class="gold">iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367</span><br>
       2. Fund it. 3. Connect to 10x AI — <span class="gold">t.me/Shiloh10xbot</span> (2 minutes)<br>
       4. Set your goal and duration. The engine trades. The plan compounds.</p>
  </div>
  <p>Nothing is guaranteed, and no system is perfect. What this guide gives you is a method that protects the base, keeps the winnings in play, and gives growth its best chance — <span class="gold">cycle after cycle.</span></p>
  <p class="footnote">· BY 10X AI ·</p>
</div>

</body>
</html>
"""

with open("/root/iqbot-v3/ebook/guide-compounding-v2.html", "w") as f:
    f.write(HTML)
print("written guide-compounding-v2.html")
