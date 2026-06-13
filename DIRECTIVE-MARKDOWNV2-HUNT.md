# DIRECTIVE: Hunt Down Remaining MarkdownV2 Surface

**Date:** 2026-06-13
**From:** Wizard
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first.

---

## Problem

Previous MarkdownV2 sweeps converted Product Access, Help, and the upgrade UI from `parse_mode: 'MarkdownV2'` to `parse_mode: 'Markdown'`. But user **7547864280** is still hitting 82 `"Character '-' is reserved"` errors TODAY. There's at least one more MarkdownV2 surface we missed.

The `bot.catch` handler catches these gracefully (shows "formatting glitch" + Start Over button) but the broken button keeps regenerating — the user is stuck in a loop.

---

## Task

1. Search the ENTIRE codebase (both `.ts` source and compiled `.js`) for **every** usage of `parse_mode: 'MarkdownV2'` — not just the ones I found earlier
2. Also search for any `editMessageText` call that inherits parse mode from a `MarkdownV2` parent message
3. For each surface found, trace whether dynamic content (user names, amounts, callback_data, etc.) is interpolated into the message
4. If any surface has unescaped dynamic content — switch it to `parse_mode: 'Markdown'` (V1) or add proper escaping
5. Bonus: check `notifyAdmin` function — it had 9 MarkdownV2 parse errors in the logs too

---

## Verification

After fixing: check PM2 error logs for user 7547864280 — zero new `Character '-' is reserved` errors.
