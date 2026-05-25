// Resolve paths relative to this file so the config works regardless of
// where the repo is checked out (no more hardcoded /root/iqbot-v3 paths).
const path = require('node:path');
const ROOT = __dirname;
const TSX  = path.join(ROOT, 'node_modules', '.bin', 'tsx');

module.exports = {
  apps: [
    {
      name:               'iqbot-v3-bot',
      script:             'src/bot.ts',
      interpreter:        TSX,
      cwd:                ROOT,
      autorestart:        true,
      restart_delay:      3000,
      max_memory_restart: '300M',
      out_file:           path.join(ROOT, 'logs', 'bot-out.log'),
      error_file:         path.join(ROOT, 'logs', 'bot-error.log'),
      env: { NODE_ENV: 'production' },
    },
    {
      name:               'iqbot-v3-monitor',
      script:             'src/monitor.ts',
      interpreter:        TSX,
      cwd:                ROOT,
      autorestart:        true,
      restart_delay:      10000,
      max_restarts:       20,
      max_memory_restart: '200M',
      out_file:           path.join(ROOT, 'logs', 'monitor-out.log'),
      error_file:         path.join(ROOT, 'logs', 'monitor-error.log'),
      env: { NODE_ENV: 'production' },
    },
  ],
};
