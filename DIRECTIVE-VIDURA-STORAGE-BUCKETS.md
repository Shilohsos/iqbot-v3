# Vidura Studios — Supabase Storage Bucket Fix

## Context

Vidura Studios at `/root/Web-Application-Builder/` allows users to upload PDF documents on the Dashboard. The upload flow:

1. Frontend (`Dashboard.tsx`) calls `uploadPdf()` from `src/lib/database.ts`
2. `uploadPdf()` uploads directly to **Supabase Storage** via the client SDK: `supabase.storage.from("pdfs").upload(...)`
3. If it fails, it logs `"PDF storage upload failed"` to console and returns `null`
4. A project is created but without a `pdf_url` — user sees nothing happened

## The Problem

The **"pdfs" storage bucket does not exist** in the Supabase project `qbnqvfbadrfukhirtitj`. The `supabase-schema.sql` at `artifacts/vidura-studios/supabase-schema.sql` defines the bucket and RLS policies, but it was **never executed** in the Supabase SQL Editor.

## Required Fix

**Option A: Run the SQL in Supabase Dashboard (simplest)**

Paste and run the storage section from `supabase-schema.sql` in the Supabase SQL Editor:
- Create `pdfs` bucket (public read, authenticated write)
- Create `avatars` bucket (public read, authenticated write)
- Create RLS policies for both buckets

**Option B (preferred): Add a setup endpoint**

Create a one-time setup script or API endpoint that creates these buckets programmatically using the Supabase Management API (requires service_role key).

**Option C: Improve error handling**

At minimum, surface the actual Supabase error to the user instead of silently failing. The current code only does `console.warn()`.

## Supabase Project

- URL: https://qbnqvfbadrfukhirtitj.supabase.co
- Anon key: stored in `.env` as `VITE_SUPABASE_KEY`
- Service role key: needs to be added to `.env` from Supabase dashboard → Settings → API
