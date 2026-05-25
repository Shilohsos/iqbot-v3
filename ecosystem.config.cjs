module.exports = {
  apps: [
    {
      name: 'iqbot-v3-bot',
      script: 'src/bot.ts',
      interpreter: '/root/iqbot-v3/node_modules/.bin/tsx',
      cwd: '/root/iqbot-v3',
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '300M',
      out_file: '/root/iqbot-v3/logs/bot-out.log',
      error_file: '/root/iqbot-v3/logs/bot-error.log',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'iqbot-v3-monitor',
      script: 'src/monitor.ts',
      interpreter: '/home/user/iqbot-v3/node_modules/.bin/tsx',
      cwd: '/home/user/iqbot-v3',
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 20,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PATH: '/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
    },
  ],
};