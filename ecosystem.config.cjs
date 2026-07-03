/**
 * PM2 — prod Infomaniak (comme zombie-survival)
 * Premier lancement : pm2 start ecosystem.config.cjs && pm2 save
 * Redémarrage      : pm2 restart hdm
 */
module.exports = {
  apps: [
    {
      name: 'hdm',
      script: 'server.mjs',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 4001,
      },
    },
  ],
};
