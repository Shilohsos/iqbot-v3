#!/usr/bin/env python3
"""
Fix remaining ₦ in results/ticker and remove bar chart graphic.
Run on VPS: python3 scripts/patch-naira-final.py

Fixes:
  1. Results array — stake/profit values ÷100, display as $toFixed(2)
  2. Ticker array — profit values ÷100, display as $toFixed(2)
  3. Results table — show 5 rows, auto-cycle through all 15 every 3s
  4. Remove .chart-area from hero (keep stats row, remove visual bars)
"""
import re
import shutil
import sys
from pathlib import Path

FUNNEL = Path("/var/www/10xbot/funnel/index.html")

if not FUNNEL.exists():
    sys.exit(f"ERROR: {FUNNEL} not found")

html = FUNNEL.read_text(encoding="utf-8")
backup = FUNNEL.with_suffix(".html.naira-final.bak")
shutil.copy(FUNNEL, backup)
print(f"Backup → {backup}")

changes: list[str] = []

# ── Fix 1A: Results array — divide stake and profit by 100 ───────────────────
# Match:  stake: 1000, profit: 1870
# We only want to touch integer stake/profit values (already-converted floats
# like 18.70 must be left alone to avoid double-division).
def convert_result_value(m: re.Match) -> str:
    key = m.group(1)          # 'stake' or 'profit'
    raw = m.group(2)          # numeric string
    # Skip if already a decimal (already converted)
    if '.' in raw:
        return m.group(0)
    val = int(raw) / 100
    return f"{key}: {val:.2f}"

original = html
# Only inside script blocks to avoid touching CSS/HTML numeric values
# Replace stake/profit integer values that look like NGN amounts (>= 100)
html = re.sub(
    r'\b(stake|profit):\s*(\d{3,})\b',
    convert_result_value,
    html,
)
if html != original:
    changes.append("Fix 1A: converted stake/profit NGN integers → USD decimals (÷100)")

# ── Fix 1B: Render function — ₦ → $, toLocaleString → toFixed(2) ─────────────
original = html

# Pattern: '₦' + r.stake.toLocaleString()  →  '$' + r.stake.toFixed(2)
html = re.sub(
    r"['\"]₦['\"](\s*\+\s*r\.\w+)\.toLocaleString\(\)",
    r"'$'\1.toFixed(2)",
    html,
)
# Pattern: '+₦' + r.profit... → '+$' + r.profit...
html = re.sub(
    r"['\"\+]*₦['\"](\s*\+\s*r\.\w+)\.toLocaleString\(\)",
    r"'+$'\1.toFixed(2)",
    html,
)
# Catch any remaining ₦ + something.toLocaleString() pattern
html = re.sub(
    r"'([^']*?)₦([^']*?)'(\s*\+[^;]+)\.toLocaleString\(\)",
    lambda m: f"'{'$'.join([m.group(1), m.group(2)])}'"+m.group(3)+".toFixed(2)",
    html,
)
# Also catch standalone ₦ symbols that weren't caught (belt-and-suspenders)
if "₦" in html:
    html = html.replace("₦", "$")
    changes.append("Fix 1B: replaced remaining ₦ symbols with $")

html = re.sub(r'\.toLocaleString\(\)', '.toFixed(2)', html)

if html != original:
    changes.append("Fix 1B: render function updated — ₦→$, toLocaleString→toFixed(2)")

# ── Fix 2: Ticker — divide profits by 100, display as $toFixed(2) ────────────
original = html

# tickerProfits array: replace integer values ≥100 with ÷100 float
def convert_ticker_val(m: re.Match) -> str:
    val = int(m.group(1))
    if val < 100:
        return m.group(0)   # already USD-scale, leave alone
    return str(round(val / 100, 2))

html = re.sub(
    r'(?<=var tickerProfits\s*=\s*\[)[^\]]+',
    lambda m: re.sub(r'\b(\d{3,})\b', convert_ticker_val, m.group(0)),
    html,
)

# Ticker render: '+₦' + profit.toLocaleString()  →  '+$' + profit.toFixed(2)
html = re.sub(
    r"'\+₦'\s*\+\s*([\w\[\]]+(?:\.\w+)?)\.toLocaleString\(\)",
    r"'+$' + \1.toFixed(2)",
    html,
)
html = re.sub(
    r"\+₦",
    "+$",
    html,
)
# Also: (tickerProfits[idx] / 100).toFixed(2) — if already divided, leave it
# Make sure division doesn't happen twice
html = re.sub(
    r"\(tickerProfits\[idx\]\s*/\s*100\)\.toFixed\(2\)",
    "tickerProfits[idx].toFixed(2)",
    html,
)

if html != original:
    changes.append("Fix 2: ticker profits ÷100, display as $toFixed(2)")

# ── Fix 3: Show 5 animated rows, cycle through all 15 every 3s ───────────────
# Replace (or inject) the results rendering + rotation logic.
# We target the script block that renders results into the DOM.

RESULTS_ROTATOR_JS = r"""
<script id="resultsRotator">
(function() {
  // Wait for DOM — results list may be rendered dynamically
  function initRotator() {
    var container = document.querySelector('.results-list, .results-body, #resultsList, .results tbody, .results-table tbody');
    if (!container) return;

    var allRows = Array.from(container.children);
    if (allRows.length <= 5) return;   // nothing to rotate

    var PAGE = 5;
    var current = 0;
    var paused = false;

    container.addEventListener('mouseenter', function() { paused = true; });
    container.addEventListener('mouseleave', function() { paused = false; });

    function showPage(idx) {
      allRows.forEach(function(row, i) {
        var inPage = (i >= idx && i < idx + PAGE);
        if (inPage) {
          row.style.display = '';
          row.style.opacity = '0';
          row.style.transform = 'translateY(6px)';
          // stagger fade-in
          setTimeout(function() {
            row.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            row.style.opacity = '1';
            row.style.transform = 'translateY(0)';
          }, (i - idx) * 60);
        } else {
          row.style.display = 'none';
          row.style.transition = '';
        }
      });
      // Highlight big wins (>= $50 profit)
      allRows.slice(idx, idx + PAGE).forEach(function(row) {
        var text = row.textContent || '';
        var match = text.match(/\+\$(\d+(?:\.\d+)?)/);
        if (match && parseFloat(match[1]) >= 50) {
          row.style.boxShadow = '0 0 0 1px rgba(77,216,101,0.4)';
        } else {
          row.style.boxShadow = '';
        }
      });
    }

    // Show first page immediately
    showPage(0);

    setInterval(function() {
      if (paused) return;
      current = (current + PAGE) % allRows.length;
      // Wrap — if remaining rows < PAGE, restart from 0
      if (current + PAGE > allRows.length) current = 0;
      showPage(current);
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRotator);
  } else {
    initRotator();
  }
})();
</script>
"""

if "resultsRotator" not in html:
    # Remove the old rotation script injected by patch-funnel-overhaul.py
    # (that one rotated one row at a time every 4s)
    old_rotator_pattern = re.compile(
        r'<script>\s*\(function\(\)\s*\{[^}]*Auto-rotate results[^<]*</script>',
        re.DOTALL
    )
    cleaned = old_rotator_pattern.sub('', html)
    if cleaned != html:
        html = cleaned
        changes.append("Fix 3: removed old single-row rotator")

    if "</body>" in html:
        html = html.replace("</body>", RESULTS_ROTATOR_JS + "\n</body>", 1)
        changes.append("Fix 3: injected 5-row page rotator (3s cycle through all results)")
    else:
        changes.append("Fix 3 SKIPPED: </body> not found")
else:
    changes.append("Fix 3 SKIPPED: resultsRotator already present")

# ── Fix 4: Remove .chart-area from hero (keep stats row) ─────────────────────
# The directive says remove the purple/green bar chart visual.
# Strategy: remove only .chart-area, preserving the stats row (95% win rate etc.)
original = html

chart_area_pat = re.compile(
    r'<div[^>]+class=["\'][^"\']*chart-area[^"\']*["\'][^>]*>.*?</div>',
    re.DOTALL
)
html = chart_area_pat.sub('', html)

if html != original:
    changes.append("Fix 4: removed .chart-area (visual bar chart) from hero section")
else:
    # Fallback: remove the entire .hero-card if chart-area wasn't found
    hero_card_pat = re.compile(
        r'<div[^>]+class=["\'][^"\']*hero-card[^"\']*["\'][^>]*>.*?</div>',
        re.DOTALL
    )
    cleaned = hero_card_pat.sub('', html)
    if cleaned != html:
        html = cleaned
        changes.append("Fix 4: removed entire .hero-card from hero section (chart-area not found separately)")
    else:
        changes.append("Fix 4 SKIPPED: neither .chart-area nor .hero-card found — check element class names manually")

# ── Write ─────────────────────────────────────────────────────────────────────
print()
for c in changes:
    prefix = "  ✓" if not c.startswith("Fix") or "SKIP" not in c else "  ⚠"
    print(f"{prefix} {c}")

if any("SKIP" not in c and "WARN" not in c for c in changes):
    FUNNEL.write_text(html, encoding="utf-8")
    print(f"\nPatched {FUNNEL}")
    print(f"Backup at: {backup}")
    print("\nVerification:")
    print("  1. Results section shows $18.70 not ₦1870")
    print("  2. Ticker shows $18.70 not ₦1870")
    print("  3. Only 5 results visible at a time, cycling every 3s")
    print("  4. Bar chart graphic gone from hero section")
else:
    print("\nNo changes written — nothing matched. Inspect element classes manually.")
    backup.unlink(missing_ok=True)
