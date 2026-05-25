# Directive: Restore Monitor Process & Fix Compose Channel Send

## 1. Restore iqbot-v3-monitor Process

The `iqbot-v3-monitor` PM2 process (`/root/iqbot-v3/src/monitor.ts`) is currently **stopped** with 0 restarts and 0 uptime. It needs to be restored.

### Steps:
1. Investigate why it stopped (check logs, PM2 error output)
2. Restart the process with PM2
3. Verify it stays online and healthy
4. The monitor script path is: `/root/iqbot-v3/src/monitor.ts`
   - It uses `BOT_TOKEN` from env to run as a secondary bot
   - It monitors trades, sends alerts, and handles system health

### PM2 process details:
- Name: `iqbot-v3-monitor`
- Script: `/root/iqbot-v3/src/monitor.ts`
- Currently: stopped with 0 restarts

## 2. Fix Compose Channel Send

When the compose post feature sends to the channel (`CHANNEL_ID`), it fails with:
```
[compose] channel send failed: 400: Bad Request: need administrator rights in the channel chat
```

The bot **does have admin rights** in the channel according to the user. So the issue may be:
- Bot was removed and re-added as admin (permissions may need refresh)
- Channel ID may have changed
- Bot may need to be promoted to admin again in the channel settings
- Or the send method may need permission to post on behalf of the bot

### Investigation:
1. Verify the bot is currently an admin in the channel `-1002766084283`
2. Try sending a simple test message to the channel manually
3. If bot is admin but send fails, check if bot needs `can_post_messages` or `can_send_messages` permissions
4. Fix and verify compose posts deliver to channel

### Affected code flow:
- `src/bot.ts` — compose delivery handler, channel send logic
- Uses `bot.telegram.sendMessage()` or `sendPhoto()` to the channel ID

## Files to Investigate
- `src/monitor.ts` — monitor process to restore
- `src/bot.ts` — compose channel send logic (~line 2540-2560)
