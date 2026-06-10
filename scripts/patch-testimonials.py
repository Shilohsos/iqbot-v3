#!/usr/bin/env python3
"""
Wire real testimonial screenshots into the landing page.
Run on VPS: python3 scripts/patch-testimonials.py

Replaces placeholder [Screenshot] divs with actual <img> tags inside
a CSS-only mock phone frame. Car buyer testimonial is the hero (first).
"""
import re
import shutil
import sys
from pathlib import Path

FUNNEL = Path("/var/www/10xbot/funnel/index.html")

if not FUNNEL.exists():
    sys.exit(f"ERROR: {FUNNEL} not found")

html = FUNNEL.read_text(encoding="utf-8")
backup = FUNNEL.with_suffix(".html.testimonials.bak")
shutil.copy(FUNNEL, backup)
print(f"Backup → {backup}")

# ── Phone frame CSS ───────────────────────────────────────────────────────────
PHONE_CSS = """
<style>
/* Phone frame for testimonial screenshots */
.phone-frame {
  position: relative;
  width: 100%;
  max-width: 260px;
  margin: 0 auto;
  background: #111;
  border-radius: 32px;
  border: 2px solid rgba(255,255,255,0.12);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.04);
  padding: 12px 8px;
}
.phone-frame::before {
  content: '';
  display: block;
  width: 40px; height: 5px;
  background: rgba(255,255,255,0.15);
  border-radius: 3px;
  margin: 0 auto 10px;
}
.phone-frame::after {
  content: '';
  display: block;
  width: 28px; height: 28px;
  background: rgba(255,255,255,0.08);
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.12);
  margin: 10px auto 0;
}
.phone-frame img {
  width: 100%;
  border-radius: 18px;
  display: block;
  object-fit: cover;
}

/* Testimonial card overrides */
.testimonial-card {
  background: var(--card-bg, rgba(255,255,255,0.04));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: 24px 16px 20px;
  max-width: 300px;
  flex: 1 1 260px;
  transition: transform 0.3s, box-shadow 0.3s;
}
.testimonial-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.4);
}
.testimonial-card.hero {
  border-color: rgba(240,180,41,0.3);
  box-shadow: 0 0 0 1px rgba(240,180,41,0.15);
}
.testimonial-caption {
  font-size: 13px;
  color: var(--text-dim, #999);
  text-align: center;
  margin-top: 12px;
  line-height: 1.5;
  font-style: italic;
}
.testimonials {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 28px;
}

/* Mobile: stack */
@media (max-width: 480px) {
  .testimonial-card { max-width: 100%; flex: 1 1 100%; }
  .phone-frame { max-width: 220px; }
}
</style>
"""

# ── New testimonial section HTML ───────────────────────────────────────────────
NEW_TESTIMONIALS_DIV = """<div class="testimonials">
      <!-- Hero testimonial: Car buyer — most powerful social proof -->
      <div class="testimonial-card hero">
        <div class="phone-frame">
          <img src="/assets/testimonial-car.jpg"
               alt="Trader bought a car with 10x AI profits"
               loading="lazy">
        </div>
        <div class="testimonial-caption">"I'm the newest car owner in town. All thanks to you and 10x AI. It happened so quickly, less than 3 weeks."</div>
      </div>
      <!-- Tony: first trade win -->
      <div class="testimonial-card">
        <div class="phone-frame">
          <img src="/assets/testimonial-tony.jpg"
               alt="Tony wins first trade with 10x Bot"
               loading="lazy">
        </div>
        <div class="testimonial-caption">"Waoh, I won the first trade" — Tony</div>
      </div>
      <!-- Josh: $200 in 4 days -->
      <div class="testimonial-card">
        <div class="phone-frame">
          <img src="/assets/testimonial-josh.jpg"
               alt="Josh makes $200 in 4 days with 10x Bot"
               loading="lazy">
        </div>
        <div class="testimonial-caption">"Made about $200 in 4 days now" — Josh</div>
      </div>
      <!-- $28k balance, aiming for $50k -->
      <div class="testimonial-card">
        <div class="phone-frame">
          <img src="/assets/testimonial-28k-balance.jpg"
               alt="Trader shows $27,937 balance heading to $50k"
               loading="lazy">
        </div>
        <div class="testimonial-caption">"I must take this account to $50k. All thanks to 10x AI."</div>
      </div>
    </div>"""

changes: list[str] = []

# ── Inject phone frame CSS ─────────────────────────────────────────────────────
if "phone-frame" not in html:
    if "</head>" in html:
        html = html.replace("</head>", PHONE_CSS + "</head>", 1)
        changes.append("Injected phone-frame CSS into <head>")
    else:
        changes.append("WARN: </head> not found — phone-frame CSS not injected")
else:
    changes.append("Phone-frame CSS already present — skipped")

# ── Replace testimonials div ───────────────────────────────────────────────────
# Strategy 1: replace the entire class="testimonials" block
testimonials_pattern = re.compile(
    r'<div class="testimonials">.*?</div>\s*</div>\s*</section>',
    re.DOTALL
)
m = testimonials_pattern.search(html)
if m:
    # Reconstruct: new testimonials div + close section-inner + close section
    replacement = NEW_TESTIMONIALS_DIV + "\n  </div>\n</section>"
    html = html[:m.start()] + replacement + html[m.end():]
    changes.append("Replaced entire .testimonials block with 4 real screenshot cards")
else:
    # Strategy 2: replace individual placeholders
    replaced = 0
    SLOTS = [
        # (id to find, caption placeholder, src, alt, caption)
        (
            'id="testimonialImage1"',
            '[Screenshot 1]',
            '/assets/testimonial-car.jpg',
            'Trader bought a car with 10x AI profits',
            '"I\'m the newest car owner in town. All thanks to you and 10x AI. It happened so quickly, less than 3 weeks."',
        ),
        (
            'id="testimonialImage2"',
            '[Screenshot 2]',
            '/assets/testimonial-tony.jpg',
            'Tony wins first trade with 10x Bot',
            '"Waoh, I won the first trade" — Tony',
        ),
        (
            'id="testimonialImage3"',
            '[Screenshot 3]',
            '/assets/testimonial-josh.jpg',
            'Josh makes $200 in 4 days with 10x Bot',
            '"Made about $200 in 4 days now" — Josh',
        ),
    ]
    for anchor, placeholder, src, alt, caption in SLOTS:
        if anchor in html:
            img_html = (
                f'<div class="phone-frame">'
                f'<img src="{src}" alt="{alt}" loading="lazy">'
                f'</div>'
            )
            # Replace the placeholder paragraph inside the testimonial-image div
            placeholder_pat = re.compile(
                re.escape(anchor) + r'.*?</div>',
                re.DOTALL
            )
            new_content = f'{anchor}>\n          {img_html}\n        </div'
            html = html.replace(placeholder, img_html, 1)
            replaced += 1

    # Add the 4th card (28k balance) if not already present
    if 'testimonial-28k-balance' not in html:
        # Find the last </div> of the testimonials div and inject before it
        last_card_end = html.rfind('</div>', 0, html.find('</section>',
            html.rfind('testimonial-section')))
        if last_card_end != -1:
            new_card = """
      <div class="testimonial-card">
        <div class="phone-frame">
          <img src="/assets/testimonial-28k-balance.jpg"
               alt="Trader shows $27,937 balance heading to $50k"
               loading="lazy">
        </div>
        <div class="testimonial-caption">"I must take this account to $50k. All thanks to 10x AI."</div>
      </div>"""
            html = html[:last_card_end] + new_card + html[last_card_end:]
            replaced += 1

    if replaced:
        changes.append(f"Replaced {replaced} placeholder(s) with real screenshot cards (individual strategy)")
    else:
        changes.append(
            "WARN: could not locate testimonial placeholders — "
            "testimonial section may not have been injected yet. "
            "Run patch-funnel-overhaul.py first, then re-run this script."
        )

# ── Write ─────────────────────────────────────────────────────────────────────
print()
for c in changes:
    print(f"  {'✓' if not c.startswith('WARN') else '⚠'} {c}")

if any(not c.startswith("WARN") and not c.startswith("SKIP") for c in changes):
    FUNNEL.write_text(html, encoding="utf-8")
    print(f"\nPatched {FUNNEL}")
    print(f"Backup at: {backup}")
    print("\nVerification:")
    print("  1. Open https://10xpremium.online — testimonials should show 4 real screenshots")
    print("  2. Check mobile layout (stack correctly under 480px)")
    print("  3. Car buyer card should be first with amber hero border")
else:
    print("\nNo changes written.")
    backup.unlink(missing_ok=True)
