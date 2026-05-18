# IMPORTANT: Merge master first

## Vidura Studios — PDF Text Extraction Fails on iPad Safari

### Context

When users upload a PDF on Vidura Studios, the frontend extracts text using pdfjs-dist@5.7.284 before sending it to the AI for course generation. The worker is loaded from CDN:

```
r.workerSrc = "https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";
```

On **iPad Safari**, this fails with:

> TypeError: undefined is not a function (near '...i of e....')

The error originates **inside pdfjs-dist** when it tries to iterate over data structures that failed to initialize — likely because the ESM `.mjs` worker doesn't load properly on Safari (ESM module worker support is limited on mobile Safari, and CORS from unpkg can also be an issue on iPad).

### The Problem

- pdfjs-dist worker loaded from **unpkg CDN** as `.mjs` (ESM module)
- iPad Safari has inconsistent support for ESM Web Workers
- The worker fails to load, causing pdfjs-dist internal methods to be undefined
- Result: `extractPdfText` crashes, upload toast shows "Something went wrong"
- **Project is still created** (uploadPdf and createProject succeed) but processing stops

### Required Fix

**Option A (recommended): Bundle worker locally**

1. Copy `pdf.worker.min.mjs` from `node_modules/pdfjs-dist/build/` into `artifacts/vidura-studios/public/`
2. Change the worker URL in `artifacts/vidura-studios/src/lib/ai.ts` from CDN to local:

```typescript
// Before:
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs`;

// After:
GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
```

3. Rebuild the frontend: `cd artifacts/vidura-studios && npx vite build`

**Option B: Use `.js` worker instead of `.mjs`**

If the local `.mjs` still fails on Safari, switch to the legacy `.js` worker:

```typescript
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.js`;
```

**Option C: Add try-catch fallback**

Wrap `extractPdfText` so that if pdfjs-dist fails entirely, it falls back to a simpler text extraction method or returns a placeholder so the user at least gets a template course.

### Files to modify

- `artifacts/vidura-studios/src/lib/ai.ts` — line with `GlobalWorkerOptions.workerSrc`

### Verification

After deploying, test on an iPad or mobile Safari:
1. Upload a PDF
2. Verify text is extracted and course is generated
3. Check browser console for pdfjs-dist errors
