# Fix DeepSeek model name — deepseek-chat → deepseek-v4-flash

## IMPORTANT: Merge master first

```bash
git checkout master && git pull origin master && git checkout -b claude/fix-deepseek-model
```

---

## Problem

The brain and LLM post generator use `deepseek-chat` which is the **old legacy model** on DeepSeek's API. The current models available are `deepseek-v4-flash` (our target) and `deepseek-v4-pro`.

The API still accepts the old name as a backwards-compatible alias but routes to an older, weaker model — explaining why the brain is "doing a terrible job."

## Changes

### 1. `.env` — update the model name

Change:
```
DEEPSEEK_MODEL=deepseek-chat
```
To:
```
DEEPSEEK_MODEL=deepseek-v4-flash
```

This applies to both the classifier (brain) and the LLM post generator (`llm.ts`), which both read from this env var.

### 2. `src/classifier.ts` — update the fallback default (line 4)

Change:
```typescript
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
```
To:
```typescript
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
```

## Verification

After deploying, check PM2 logs for brain responses:
```bash
pm2 logs iqbot-v3-bot --lines 50 --nostream | grep "\[brain"
```

If the model name was wrong, the API would return an error and the brain would fall back to `go_home`. With the correct model, classification should be noticeably better.
