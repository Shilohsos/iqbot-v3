module.exports = {
    apps: [
        {
            name:        'iqbot-v3-bot',
            script:      'src/bot.ts',
            interpreter: 'npx',
            interpreter_args: 'tsx',
            env: { NODE_ENV: 'production' },
            restart_delay: 5000,
            max_restarts: 10,
        },
        {
            name:        'iqbot-v3-monitor',
            script:      'src/monitor.ts',
            interpreter: 'node_modules/.bin/tsx',
            env: { NODE_ENV: 'production', PATH: '/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
            restart_delay: 10000,
            max_restarts: 20,
        },
    ],
};
