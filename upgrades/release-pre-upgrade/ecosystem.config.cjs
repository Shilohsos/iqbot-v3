module.exports = {
  apps: [{
    name: 'iqbot-v3-bot',
    script: 'dist/bot.js',
    cwd: '/root/iqbot-v3',
    max_memory_restart: '550M',
    autorestart: true
  }]
};
