# DIRECTIVE: User ID verification — full-history affiliate check (window-orphan fix)

**Date:** 2026-08-16
**Status:** REQUESTING IMPLEMENTATION
**Branch to create:** `claude/affiliate-verification-full-history`

---

## 1. The user-facing bug

New users who registered via the affiliate link send their IQ Option User ID to the bot and get:

```
❌ Couldn't verify your User ID.
Contact admin for manual verification
They'll help you get set up.
[Contact Admin]
```

even though their ID **is** on the affiliate channel. 2026-08-16 case: user 8381978441 (IQ ID 195190255, registered ~00:05) failed verification **5 times** across the day. Admin manually confirmed the ID is on the channel with the correct link. Two more users (Steven/Bibbie chats) hit the same wall the same evening.

## 2. Root cause

`src/affiliate.ts` — `checkAffiliate(iqUserId)`:

1. Scans **only the last `AFFILIATE_SCAN_LIMIT` (env, currently 1000) messages** of the affiliate channel via `client.getMessages(channelId, { limit })` and looks for the raw ID string in `msg.text`.
2. If not found, falls back to the `lead_events` table — **but `lead_events` only contains FTD/redep (deposit) events** written by the sales bot. A brand-new user who has registered but not deposited has NO `lead_events` row.
3. Any message older than the window (registration scrolled out) or any message where the ID is not inside `msg.text` (media/caption formats) → `{ found: false }` → permanent verification failure for a legitimate user.

There is no full-history search and no persistence of registration messages. The 1000-message window is a moving target that silently orphans older-but-legitimate registrations.

## 3. Required fix

Make verification consult **all channel history**, not a window, with a durable local record as the source of truth:

1. **Telegram-side full-history search (primary):** in `checkAffiliate()`, use `client.getMessages(channelId, { search: userIdStr, limit: 10 })` — this is a server-side search over the channel's ENTIRE history, so registration age no longer matters. Return found=true with the matched message text/date when any message contains the ID.

2. **Persist every channel message (durable fallback):** add a table `affiliate_messages` (id INTEGER PK, channel_msg_id INTEGER, iq_user_id TEXT, raw_text TEXT, msg_date TEXT). Populate it lazily from `checkAffiliate()` when the search misses: paginate the channel backwards (batches of ~200, up to e.g. 5000 messages or 15 pages) and INSERT OR IGNORE every message's text + any 9-digit ID found via regex (`\b(19\d{7})\b`). Then re-check the table. All subsequent verifications for that ID hit the local table instantly.

3. **Keep the existing `lead_events` fallback** as a third layer (it covers deposits).

4. **ID extraction robustness:** match the ID in the raw message text with the regex `\b(19\d{7})\b` in addition to `includes()`, so formats like `ID: 195190255`, `user_id: 195190255`, or payloads with surrounding punctuation are caught.

5. **Do NOT change** the approval flow, `approveUser`, the fail-count escalation (3-tier), or admin notifications. Only the lookup logic in `src/affiliate.ts` (+ the new table in `src/db.ts` schema, created idempotently).

## 4. Constraints

- `src/affiliate.ts` and `src/db.ts` are tsc-compiled — normal TypeScript is fine.
- Do NOT touch `dist/` (gitignored, rebuilt locally after merge).
- The GramJS singleton client pattern in `src/affiliate.ts` must stay singleton — do not create a second Telegram client anywhere.
- Keep every network call inside a timeout (existing `Promise.race` 15s pattern); a slow search/pagination must degrade to the local table, never block the user's verification longer than the existing 15s cap.
- Do NOT alter `lead_events`, the sales bot, or any other module.

## 5. Deliverables

- Branch `claude/affiliate-verification-full-history` with the fix in `src/affiliate.ts` + schema addition in `src/db.ts`.
- `REPORT.md` at branch root: what changed, the pagination/search behavior, and how to verify (log line on miss→paginate→hit).

## 6. Scope discipline

Work ONLY within the files named in this directive (`src/affiliate.ts`, `src/db.ts`). Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by the directive. Everything outside the directive is out of scope — ignore it entirely.
