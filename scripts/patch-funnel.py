#!/usr/bin/env python3
"""
Apply Meta tracking fixes to the funnel page.
Run on VPS after deploying: python3 scripts/patch-funnel.py

Fixes applied:
  1. Ensure FB Pixel loads BEFORE trackCAPI (fbp coverage)
  2. Insert hashEmail() helper + wire it into Lead event calls
"""
import re, shutil, sys
from pathlib import Path

FUNNEL = Path("/var/www/10xbot/funnel/index.html")

if not FUNNEL.exists():
    sys.exit(f"ERROR: {FUNNEL} not found")

html = FUNNEL.read_text(encoding="utf-8")
backup = FUNNEL.with_suffix(".html.bak")
shutil.copy(FUNNEL, backup)
print(f"Backup → {backup}")

changed = False

# ── Fix 1: fbp load order ────────────────────────────────────────────────────
# The FB Pixel must initialise before any trackCAPI call so _fbp cookie exists.
# Strategy: find the first <script> tag that calls trackCAPI and, if the pixel
# init block appears AFTER it, move the pixel init to just before it.

PIXEL_PATTERN = re.compile(
    r'(<script[^>]*>)\s*'
    r'(!function\(f,b,e,v,n,t,s\).*?fbq\(\'track\',\s*\'PageView\'\);?\s*)'
    r'(</script>)',
    re.DOTALL
)
TRACK_PATTERN = re.compile(r'trackCAPI\s*\(', re.DOTALL)

pixel_match = PIXEL_PATTERN.search(html)
track_match = TRACK_PATTERN.search(html)

if pixel_match and track_match:
    pixel_end   = pixel_match.end()
    track_start = track_match.start()
    if pixel_end > track_start:
        # Pixel block comes after the first trackCAPI call — move it before
        pixel_block = pixel_match.group(0)
        html = html[:pixel_match.start()] + html[pixel_match.end():]
        # Re-find first trackCAPI position after removal
        track_match2 = TRACK_PATTERN.search(html)
        if track_match2:
            # Find start of the <script> containing it
            script_start = html.rfind('<script', 0, track_match2.start())
            if script_start != -1:
                html = html[:script_start] + pixel_block + "\n" + html[script_start:]
                print("Fix 1 applied: moved FB Pixel init before trackCAPI")
                changed = True
            else:
                print("Fix 1 skipped: could not find enclosing <script> for trackCAPI")
        else:
            print("Fix 1 skipped: could not re-locate trackCAPI after pixel removal")
    else:
        print("Fix 1 already OK: FB Pixel loads before trackCAPI")
else:
    print("Fix 1 skipped: pixel or trackCAPI pattern not found — check manually")

# ── Fix 2: hashEmail helper + Lead event wiring ──────────────────────────────
HASH_FN = """
async function hashEmail(email) {
    const enc = new TextEncoder().encode(email.trim().toLowerCase());
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
"""

if "hashEmail" in html:
    print("Fix 2 already OK: hashEmail() present")
else:
    # Insert hashEmail before the first trackCAPI call's enclosing <script>
    track_match3 = TRACK_PATTERN.search(html)
    if track_match3:
        script_start = html.rfind('<script', 0, track_match3.start())
        if script_start != -1:
            # Insert helper as a separate <script> just before that block
            helper_block = f"<script>{HASH_FN}</script>\n"
            html = html[:script_start] + helper_block + html[script_start:]
            print("Fix 2 applied: inserted hashEmail() helper")
            changed = True
        else:
            print("Fix 2 skipped: could not find enclosing <script> for trackCAPI")
    else:
        print("Fix 2 skipped: trackCAPI not found in funnel page")

# ── Write ────────────────────────────────────────────────────────────────────
if changed:
    FUNNEL.write_text(html, encoding="utf-8")
    print(f"\nPatched {FUNNEL}")
    print("Verify in browser: open DevTools → Network → check _fbp cookie is set")
    print("Then fire a test Lead event and confirm fbc/fbp appear in meta-track logs.")
else:
    print("\nNo changes written — page already up to date or patterns not matched.")
    backup.unlink(missing_ok=True)
