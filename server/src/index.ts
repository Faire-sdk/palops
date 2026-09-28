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

const pruneTimer = setInterval(() => services.sessions.pruneExpired(), 60 * 60 * 1000);
pruneTimer.unref();

await app.listen({ host: config.host, port: config.port });

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
