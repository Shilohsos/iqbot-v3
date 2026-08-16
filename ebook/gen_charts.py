#!/usr/bin/env python3
"""Generate the 10x AI Compounding Guide HTML with computed SVG charts."""
import math

# ── Chart math ────────────────────────────────────────────────────────────────
def curve(start, daily_pct, days):
    r = 1 + daily_pct / 100.0
    return [round(start * (r ** d), 2) for d in range(days + 1)]

# Chart 1: $10 over 21 days at 15/20/25%
c15 = curve(10, 15, 21)
c20 = curve(10, 20, 21)
c25 = curve(10, 25, 21)

# Chart 2: $10 -> $1,000 journey (25%/day) with week milestones
journey = c25

# Chart 3: big capital $1,000 at 8%/day over 21 days
c8 = curve(1000, 8, 21)

# ── SVG helpers ───────────────────────────────────────────────────────────────
def svg_chart(days, series, width=680, height=300, pad_l=58, pad_b=40, pad_t=16, pad_r=16,
              labels=None, area_fill=False, yfmt=lambda v: f"${v:,.0f}"):
    maxv = max(max(s[1]) for s in series)
    minv = 0
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    def X(d): return pad_l + plot_w * (d / days)
    def Y(v): return pad_t + plot_h * (1 - (v - minv) / (maxv - minv))

    # horizontal gridlines
    parts = []
    for i in range(5):
        v = minv + (maxv - minv) * (i / 4)
        y = Y(v)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{width-pad_r}" y2="{y:.1f}" stroke="#1E1E24" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l-8}" y="{y+4:.1f}" fill="#6A6A70" font-size="9" text-anchor="end">{yfmt(v)}</text>')
    # x labels
    for d in range(0, days + 1, 3):
        parts.append(f'<text x="{X(d):.1f}" y="{height-pad_b+16:.1f}" fill="#6A6A70" font-size="9" text-anchor="middle">Day {d}</text>')

    for (name, data, color, dash) in series:
        pts = " ".join(f"{X(d):.1f},{Y(v):.1f}" for d, v in enumerate(data))
        if area_fill and name == series[-1][0]:
            parts.append(f'<polygon points="{pad_l},{Y(0):.1f} {pts} {X(days):.1f},{Y(0):.1f}" fill="rgba(245,184,0,0.08)"/>')
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.5" stroke-dasharray="{dash}" stroke-linecap="round"/>')
        ly = Y(data[-1])
        parts.append(f'<text x="{X(days)-4:.1f}" y="{ly+4:.1f}" fill="{color}" font-size="9.5" text-anchor="end" font-weight="700">{name}</text>')

    if labels:
        for (d, v, txt) in labels:
            parts.append(f'<circle cx="{X(d):.1f}" cy="{Y(v):.1f}" r="4" fill="#FFFFFF" stroke="#F5B800" stroke-width="2"/>')
            parts.append(f'<text x="{X(d):.1f}" y="{Y(v)-10:.1f}" fill="#FFFFFF" font-size="9.5" text-anchor="middle" font-weight="700">{txt}</text>')

    return f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#0F0F13;border-radius:3mm;">{"".join(parts)}</svg>'

# Chart 1: the compounding curves
chart1 = svg_chart(21, [
    ("+15%/day", c15, "#8A8A8F", "4 4"),
    ("+20%/day", c20, "#E8E6E0", "4 4"),
    ("+25%/day", c25, "#F5B800", "none"),
])

# Chart 2: $10 -> $1,000 journey with week milestones
chart2 = svg_chart(21, [("Your account", journey, "#F5B800", "none")],
                   area_fill=True,
                   labels=[(0, 10, "$10"), (7, journey[7], "$48"), (14, journey[14], "$227"), (21, journey[21], "$1,000+")])

# Chart 3: big capital
chart3 = svg_chart(21, [("+8%/day", c8, "#F5B800", "none")],
                   area_fill=True,
                   labels=[(0, 1000, "$1,000"), (21, c8[21], "$5,000+")])

with open("/root/iqbot-v3/ebook/charts.json", "w") as f:
    import json
    json.dump({"c15": c15, "c20": c20, "c25": c25, "c8": c8}, f)

print("charts computed")
print("10@25%/day:", c15[-1], c20[-1], c25[-1])
print("1k@8%/day:", c8[-1])
