# DIRECTIVE: Add Descriptions to Media Library Buttons

## Problem
Media Library buttons show only the raw template key (e.g. `❌ entry_stuck`). The admin has no way to know what each key is for without remembering the sequence design.

## Fix 1: Add description map to getAllSequenceMediaKeys (db.ts)

Update `getAllSequenceMediaKeys()` in `src/db.ts` to return a `description` field:

```typescript
export function getAllSequenceMediaKeys(): { template_key: string; media_type: string | null; description: string }[] {
    const keys: { key: string; desc: string }[] = [
        { key: 'entry_stuck',     desc: 'User didn\'t respond to welcome' },
        { key: 'new_trader_video', desc: 'How it works explainer video' },
        { key: 'user_id_stuck',   desc: 'User stopped at User ID step' },
        { key: 'email_stuck',     desc: 'User stopped at email step' },
        { key: 'password_stuck',  desc: 'User stopped at password step' },
        { key: 'never_traded',    desc: 'Connected but never traded' },
    ];
    return keys.map(k => {
        const row = db.prepare('SELECT media_type FROM sequence_media WHERE template_key = ?').get(k.key) as { media_type: string } | undefined;
        return { template_key: k.key, media_type: row?.media_type ?? null, description: k.desc };
    });
}
```

## Fix 2: Update button text in mediaLibraryKeyboard (ui/admin.ts)

Update `mediaLibraryKeyboard` to show description on button text:

Current:
```typescript
text: `${k.media_type ? '✅' : '❌'} ${k.template_key}`,
```

New:
```typescript
text: `${k.media_type ? '✅' : '❌'} ${k.template_key} — ${k.description}`,
```

The buttons will now show:
```
❌ entry_stuck — User didn't respond to welcome
❌ new_trader_video — How it works explainer video
```

## Verification
- Tapping admin:media_library shows buttons with clear descriptions
- Red ❌ = no media uploaded, green ✅ = has media
