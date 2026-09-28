import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './database/db.js';
import { createServices } from './services/index.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; rely on the real environment.
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
const services = createServices(config, db);
const app = await buildApp(services);

if (config.devMockServer && !services.servers.getPrimary()) {
  services.servers.savePrimary({ name: 'Local mock server', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  app.log.info('DEV_MOCK_SERVER: connected the mock Palworld server');
}

const pruneTimer = setInterval(() => {
  services.sessions.pruneExpired();
  services.siteAccounts.pruneExpired();
}, 60 * 60 * 1000);
pruneTimer.unref();

// Record who is online once a minute so known players, first/last seen and
// levels stay current even when nobody has the panel open.
const playerTimer = setInterval(() => {
  if (!services.servers.getPrimary()) return;
  services.players.refreshOnline().catch(() => services.players.markAllOffline());
}, 60 * 1000);
playerTimer.unref();

await app.listen({ host: config.host, port: config.port });

if (config.devDiscordLogin) {
  app.log.warn('DEV_DISCORD_LOGIN is on: Discord sign-in uses a local stand-in page. Development only.');
}

const setupToken = services.setup.pendingToken;
if (setupToken) {
  app.log.warn(`No accounts exist yet. Open the panel and create the owner account with this setup token: ${setupToken}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
