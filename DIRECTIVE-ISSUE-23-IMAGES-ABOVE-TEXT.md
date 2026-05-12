# Issue #23 — Images should appear ABOVE text, not below

## Problem

In several places throughout the bot, text messages are sent **before** their accompanying image. This makes the image appear below the text in the chat, which looks less polished.

## Required: all images above all text

For every step, the image should be sent **first**, then the text follows below it.

## Locations to fix

### 1. Signal direction trend image (bot.ts line 553-558)

**Current:**
```typescript
await ctx.reply(
    `OPPORTUNITY FOUND\nConfidence: 78% · Bot is ready to execute.\n\n${dirStr}\n\n...`
);
try { await ctx.replyWithPhoto(ASSET(signalImg)); } catch {}  // IMAGE BELOW TEXT ❌
```

**Fix:** Send L9 image before the opportunity text:
```typescript
// Send trend image first
try { await ctx.replyWithPhoto(ASSET(signalImg)); } catch {}
// Then the opportunity text
await ctx.reply(
    `OPPORTUNITY FOUND\nConfidence: 78% · Bot is ready to execute.\n\n${dirStr}\n\n...`
);
```

### 2. Martingale win result (bot.ts, runMartingale)

**Current:**
```typescript
await sendRoundImage(round === 1 ? 'L11a.png' : 'L11b.png');  // Image
await ctx.reply(                                                // Text below — this is correct ✅
    `🏆 +$${result.pnl.toFixed(2)} added to your balance...`
);
```

Double-check that ALL calls to `sendRoundImage()` happen before their matching `ctx.reply()` calls.

### 3. Smart Recovery Activated (bot.ts, runMartingale)

**Current:**
```typescript
await sendRoundImage('L10.png');        // Image first ✅
await ctx.reply('SMART RECOVERY ACTIVATED...'); // Text below ✅
```
This one looks correct already.

### 4. All lost (bot.ts, runMartingale)

**Current:**
```typescript
await sendRoundImage('L11c.png');       // Image first ✅
await ctx.reply(`Lost this one 💔!...`);   // Text below ✅
```
Correct.

### 5. Martingale error (bot.ts, runMartingale)

Check if any image is sent text-first after an error.

### 6. General principle

Everywhere in the codebase: if an image and text message accompany each other, the **image must come first**, text second. Do a full scan of all `replyWithPhoto` / `sendRoundImage` calls and ensure they precede their associated `reply` call.

## Files

- `src/bot.ts` — line 553-558 (signal image + text swap), full scan of all image/text pairs
