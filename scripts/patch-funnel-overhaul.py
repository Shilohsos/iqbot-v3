#!/usr/bin/env python3
"""
Funnel page overhaul — apply all changes from DIRECTIVE-FUNNEL-OVERHAUL.md.

Changes applied:
  A1. ₦ → $ currency (with NGN/100 USD scaling)
  A2. "Message Admin" → "Talk to Admin"
  A3. "Join Channel" btn-outline → equal-weight amber/gold btn-primary
  A4. Scarcity elements (live visitor counter + spots remaining)
  A5. Auto-rotating results table
  A6. Testimonial section placeholder
  A7. Visual polish — entrance animations (Intersection Observer + fade-up)

Run on VPS: python3 scripts/patch-funnel-overhaul.py
"""
import re
import shutil
import sys
from pathlib import Path

FUNNEL = Path("/var/www/10xbot/funnel/index.html")

if not FUNNEL.exists():
    sys.exit(f"ERROR: {FUNNEL} not found")

html = FUNNEL.read_text(encoding="utf-8")
backup = FUNNEL.with_suffix(".html.overhaul.bak")
shutil.copy(FUNNEL, backup)
print(f"Backup → {backup}")

changes: list[str] = []

# ── A1: Currency — ₦ → $ ──────────────────────────────────────────────────────
# Known specific values from directive
SPECIFIC = [
    ("₦30K",  "$300"),
    ("₦10M",  "$100,000"),
    ("₦30,000", "$300"),
    ("₦10,000,000", "$100,000"),
]
for ngn, usd in SPECIFIC:
    if ngn in html:
        html = html.replace(ngn, usd)
        changes.append(f"A1: replaced {ngn} → {usd}")

# Generic: ₦<digits> → $ equivalent (divide by 100, format sensibly)
def convert_ngn(m: re.Match) -> str:
    raw = m.group(1).replace(",", "")
    try:
        val = int(raw) // 100
    except ValueError:
        return m.group(0)
    if val >= 1000:
        return f"${val:,}"
    if val >= 10:
        return f"${val:.0f}"
    return f"${val:.2f}"

original = html
html = re.sub(r"₦([\d,]+)", convert_ngn, html)
if html != original:
    changes.append("A1: converted remaining ₦ amounts to $ (÷100)")

# Subtitle
old_subtitle = "Real Results. Real Naira."
new_subtitle = "Real Results. Real Profits."
if old_subtitle in html:
    html = html.replace(old_subtitle, new_subtitle)
    changes.append(f"A1: subtitle '{old_subtitle}' → '{new_subtitle}'")

# ── A2: CTA Text — "Message Admin" → "Talk to Admin" ─────────────────────────
old_cta = "Message Admin"
new_cta = "Talk to Admin"
count_a2 = html.count(old_cta)
if count_a2:
    html = html.replace(old_cta, new_cta)
    changes.append(f"A2: '{old_cta}' → '{new_cta}' ({count_a2} occurrence(s))")

# ── A3: "Join Channel" — btn-outline → amber btn-primary ─────────────────────
# Target the anchor tag that leads to the channel with btn-outline class
OLD_JOIN = 'href="https://t.me/+rPvBi_BnG5s5Zjg0"'
if OLD_JOIN in html:
    # Add/replace class and style on the Join Channel button
    # Regex: find the <a> tag containing the channel URL, replace class
    def upgrade_join_btn(m: re.Match) -> str:
        tag = m.group(0)
        # Replace btn-outline with btn-primary
        tag = re.sub(r'class="[^"]*btn-outline[^"]*"', 'class="btn-primary"', tag)
        # Remove any existing inline style and add the amber gradient
        tag = re.sub(r'\s*style="[^"]*"', '', tag)
        # Insert style before the closing >
        tag = re.sub(
            r'(href="https://t\.me/\+rPvBi_BnG5s5Zjg0")',
            r'\1 style="background:linear-gradient(135deg,#f0b429,#d97706);'
            r'box-shadow:0 4px 24px rgba(240,180,41,0.35)"',
            tag,
        )
        return tag

    pattern = re.compile(r'<a[^>]*href="https://t\.me/\+rPvBi_BnG5s5Zjg0"[^>]*>', re.DOTALL)
    new_html = pattern.sub(upgrade_join_btn, html)
    if new_html != html:
        html = new_html
        changes.append("A3: 'Join Channel' upgraded to amber btn-primary")
    else:
        changes.append("A3 SKIPPED: could not locate Join Channel <a> tag — check manually")

# ── A4: Scarcity elements ─────────────────────────────────────────────────────
SCARCITY_CSS = """
<style>
.scarcity-bar {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; background: rgba(77,216,101,0.08);
  border: 1px solid rgba(77,216,101,0.2); border-radius: 999px;
  font-size: 13px; color: var(--text-dim); margin-bottom: 16px;
}
.live-dot {
  width: 6px; height: 6px; background: var(--green);
  border-radius: 50%; animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%,100% { opacity:1; transform:scale(1); }
  50%      { opacity:0.4; transform:scale(1.4); }
}
.spots-bar {
  font-size: 13px; color: var(--amber, #f0b429);
  margin-bottom: 16px; letter-spacing: 0.02em;
}
</style>
"""

SCARCITY_HTML = """
<div class="scarcity-bar">
  <span class="live-dot"></span> <span id="visitorCount">47</span> people viewing right now
</div>
<div class="spots-bar">
  ⚡ <span id="spotsCount">18</span> of <span>20</span> trading spots activated today
</div>
"""

SCARCITY_JS = """
<script>
(function() {
  // Visitor count — randomises between 42-78 every 30s (social proof mechanic)
  function updateVisitors() {
    var el = document.getElementById('visitorCount');
    if (el) el.textContent = Math.floor(Math.random() * 37) + 42;
  }
  updateVisitors();
  setInterval(updateVisitors, 30000);

  // Spots remaining — decrements toward 0 across the day, resets at midnight
  function getSpots() {
    var key = 'spotsDay', dayKey = 'spotsDate';
    var today = new Date().toDateString();
    if (localStorage.getItem(dayKey) !== today) {
      localStorage.setItem(dayKey, today);
      localStorage.setItem(key, '18');
    }
    return parseInt(localStorage.getItem(key) || '18', 10);
  }
  function decrementSpots() {
    var spots = getSpots();
    if (spots > 0) {
      spots = Math.max(0, spots - 1);
      localStorage.setItem('spotsDay', spots);
    }
    var el = document.getElementById('spotsCount');
    if (el) el.textContent = spots;
  }
  decrementSpots();
  // Slow trickle — decrement once every 8 minutes on average
  setInterval(decrementSpots, 8 * 60 * 1000);
})();
</script>
"""

# Inject CSS into <head> or before </head>
if "visitorCount" not in html:
    if "</head>" in html:
        html = html.replace("</head>", SCARCITY_CSS + "</head>", 1)
        changes.append("A4: injected scarcity CSS into <head>")

    # Find first <h1 or hero heading and inject scarcity HTML before it
    hero_pattern = re.compile(r'(<h1[^>]*>)', re.IGNORECASE)
    hero_match = hero_pattern.search(html)
    if hero_match:
        html = html[:hero_match.start()] + SCARCITY_HTML + html[hero_match.start():]
        changes.append("A4: injected visitor/spots bars before first <h1>")
    else:
        # Fallback: inject before the first CTA button
        cta_match = html.find("Talk to Admin")
        if cta_match == -1:
            cta_match = html.find("Message Admin")
        if cta_match != -1:
            anchor_start = html.rfind("<", 0, cta_match)
            html = html[:anchor_start] + SCARCITY_HTML + html[anchor_start:]
            changes.append("A4: injected scarcity bars before CTA (fallback)")
        else:
            changes.append("A4 SKIPPED: could not locate hero heading — inject manually")

    # Inject JS before </body>
    if "</body>" in html:
        html = html.replace("</body>", SCARCITY_JS + "\n</body>", 1)
        changes.append("A4: injected scarcity JS before </body>")
else:
    changes.append("A4 SKIPPED: scarcity elements already present")

# ── A5: Auto-rotating results ─────────────────────────────────────────────────
ROTATION_JS = """
<script>
(function() {
  // Auto-rotate results list every 4s — top item fades out, appended to bottom
  var resultsList = document.querySelector('.results-list, .results table tbody, #resultsList, [class*="result"]');
  if (!resultsList) return;

  var items = Array.from(resultsList.children);
  if (items.length < 2) return;

  var paused = false;
  resultsList.addEventListener('mouseenter', function() { paused = true; });
  resultsList.addEventListener('mouseleave', function() { paused = false; });

  function highlightBigWins() {
    Array.from(resultsList.children).forEach(function(row) {
      var text = row.textContent || '';
      var match = text.match(/\$(\d+(?:\.\d+)?)/);
      if (match && parseFloat(match[1]) >= 50) {
        row.style.transition = 'box-shadow 0.3s';
        row.style.boxShadow = '0 0 0 1px rgba(77,216,101,0.4)';
      } else {
        row.style.boxShadow = '';
      }
    });
  }

  highlightBigWins();

  setInterval(function() {
    if (paused) return;
    var first = resultsList.firstElementChild;
    if (!first) return;
    first.style.transition = 'opacity 0.4s, transform 0.4s';
    first.style.opacity = '0';
    first.style.transform = 'translateY(-8px)';
    setTimeout(function() {
      first.style.transition = '';
      first.style.opacity = '0';
      first.style.transform = '';
      resultsList.appendChild(first);
      void first.offsetWidth; // reflow
      first.style.transition = 'opacity 0.4s, transform 0.4s';
      first.style.opacity = '1';
      first.style.transform = 'translateY(0)';
      highlightBigWins();
    }, 420);
  }, 4000);
})();
</script>
"""

if "Auto-rotate results" not in html and "rotateResults" not in html:
    if "</body>" in html:
        html = html.replace("</body>", ROTATION_JS + "\n</body>", 1)
        changes.append("A5: injected results auto-rotation JS before </body>")
    else:
        changes.append("A5 SKIPPED: </body> not found")
else:
    changes.append("A5 SKIPPED: rotation already present")

# ── A6: Testimonial section ───────────────────────────────────────────────────
TESTIMONIAL_CSS = """
<style>
.testimonials { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; margin-top: 24px; }
.testimonial-card {
  background: var(--card-bg, rgba(255,255,255,0.04));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px; padding: 20px; max-width: 340px;
  display: flex; flex-direction: column; gap: 10px;
}
.testimonial-image {
  border-radius: 10px; overflow: hidden;
  background: rgba(255,255,255,0.04); min-height: 140px;
  display: flex; align-items: center; justify-content: center;
}
.testimonial-image img { width: 100%; border-radius: 10px; display: block; }
.testimonial-caption {
  font-size: 12px; color: var(--text-dim, #888); text-align: center;
}
</style>
"""

TESTIMONIAL_HTML = """
<!-- TESTIMONIALS — add screenshot image URLs below -->
<section class="testimonial-section fade-up">
  <div class="section-inner">
    <h2 class="section-title">What Traders Say</h2>
    <div class="testimonials">
      <div class="testimonial-card">
        <div class="testimonial-image" id="testimonialImage1">
          <!-- Replace with: <img src="screenshots/result1.jpg" alt="Trader result"> -->
          <p style="color:var(--text-dim,#888);padding:40px;text-align:center">[Screenshot 1]</p>
        </div>
        <div class="testimonial-caption">Real user result from 10x Bot AI</div>
      </div>
      <div class="testimonial-card">
        <div class="testimonial-image" id="testimonialImage2">
          <!-- Replace with: <img src="screenshots/result2.jpg" alt="Trader result"> -->
          <p style="color:var(--text-dim,#888);padding:40px;text-align:center">[Screenshot 2]</p>
        </div>
        <div class="testimonial-caption">Real user result from 10x Bot AI</div>
      </div>
      <div class="testimonial-card">
        <div class="testimonial-image" id="testimonialImage3">
          <!-- Replace with: <img src="screenshots/result3.jpg" alt="Trader result"> -->
          <p style="color:var(--text-dim,#888);padding:40px;text-align:center">[Screenshot 3]</p>
        </div>
        <div class="testimonial-caption">Real user result from 10x Bot AI</div>
      </div>
    </div>
  </div>
</section>
"""

if "testimonial-section" not in html:
    # Inject CSS
    if "</head>" in html:
        html = html.replace("</head>", TESTIMONIAL_CSS + "</head>", 1)
        changes.append("A6: injected testimonial CSS into <head>")

    # Inject section before the final CTA section or before </body>
    # Try common patterns for a "final CTA" section
    cta_anchors = [
        'class="cta-section"',
        'class="final-cta"',
        'id="cta"',
        'id="final-cta"',
    ]
    inserted = False
    for anchor in cta_anchors:
        idx = html.find(anchor)
        if idx != -1:
            # Find the <section or <div opening tag before this anchor
            tag_start = html.rfind("<", 0, idx)
            html = html[:tag_start] + TESTIMONIAL_HTML + "\n" + html[tag_start:]
            changes.append(f"A6: injected testimonial section before '{anchor}'")
            inserted = True
            break

    if not inserted:
        # Fallback: inject just before last CTA button block
        last_cta = html.rfind("Talk to Admin")
        if last_cta == -1:
            last_cta = html.rfind("Message Admin")
        if last_cta != -1:
            section_start = html.rfind("<section", 0, last_cta)
            if section_start == -1:
                section_start = html.rfind("<div", 0, last_cta)
            if section_start != -1:
                html = html[:section_start] + TESTIMONIAL_HTML + "\n" + html[section_start:]
                changes.append("A6: injected testimonial section before last CTA (fallback)")
            else:
                changes.append("A6 SKIPPED: could not locate injection point — add manually")
        else:
            changes.append("A6 SKIPPED: no CTA anchor found")
else:
    changes.append("A6 SKIPPED: testimonial section already present")

# ── A7: Entrance animations (Intersection Observer + fade-up) ─────────────────
ANIMATION_CSS = """
<style>
.fade-up {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.fade-up.visible {
  opacity: 1;
  transform: translateY(0);
}
</style>
"""

ANIMATION_JS = """
<script>
(function() {
  // Intersection Observer — fade-up sections as they scroll into view
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  // Target sections + cards
  var selectors = 'section, .card, .result-card, .feature, .step, .testimonial-card, .scarcity-bar, .spots-bar';
  document.querySelectorAll(selectors).forEach(function(el) {
    // Skip hero elements — they should be visible immediately
    if (el.closest('.hero, #hero, [class*="hero"]')) return;
    el.classList.add('fade-up');
    observer.observe(el);
  });
})();
</script>
"""

if "IntersectionObserver" not in html:
    if "</head>" in html:
        html = html.replace("</head>", ANIMATION_CSS + "</head>", 1)
        changes.append("A7: injected fade-up animation CSS")
    if "</body>" in html:
        html = html.replace("</body>", ANIMATION_JS + "\n</body>", 1)
        changes.append("A7: injected Intersection Observer animation JS")
else:
    changes.append("A7 SKIPPED: IntersectionObserver already present")

# ── Write ─────────────────────────────────────────────────────────────────────
if changes:
    FUNNEL.write_text(html, encoding="utf-8")
    print(f"\nPatched {FUNNEL}")
    for c in changes:
        print(f"  ✓ {c}")
    print(f"\nBackup at: {backup}")
    print("\nNext steps:")
    print("  1. Open https://10xpremium.online in browser and verify changes")
    print("  2. Add real screenshot images to testimonial placeholders")
    print("  3. Verify ₦ amounts are all converted correctly in the results table")
    print("  4. Test Meta CAPI: curl -X POST http://localhost:8766/api/track ...")
else:
    print("No changes written — page already up to date.")
    backup.unlink(missing_ok=True)
