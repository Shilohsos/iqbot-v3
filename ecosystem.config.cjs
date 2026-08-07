module.exports = {
  apps: [{
    name: 'iqbot-v3-bot',
    script: 'dist/bot.js',
    cwd: '/root/iqbot-v3',
    // Stay-Alive Phase A: seatbelt only. Real peak was ~500-550M; 1G headroom
    // until Phase B flattens RSS. Do not thrash live trades.
    max_memory_restart: '1G',
    autorestart: true,
    min_uptime: '60s',
    max_restarts: 15,
    restart_delay: 5000,
    kill_timeout: 30000,
    exp_backoff_restart_delay: 3000,
    // Merge logs for restart forensics
    time: true,
  }, {
    // Phase D: lightweight external watcher (no IQ sockets)
    name: 'iqbot-stay-alive',
    script: 'upgrades/scripts/stay-alive-monitor.mjs',
    cwd: '/root/iqbot-v3',
    autorestart: true,
    max_memory_restart: '80M',
    min_uptime: '10s',
    restart_delay: 10000,
    time: true,
  }]
};
