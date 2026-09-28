#!/usr/bin/env node
// Prepares a local development environment: writes server/.env with safe
// local defaults (never overwrites an existing one). `--reset` also deletes
// the local database so you can start from first-run setup again.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, 'server', '.env');
const dataDir = join(root, 'server', 'data');

if (process.argv.includes('--reset')) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log('Deleted the local database (server/data). The next start begins at first-run setup.');
}

if (existsSync(envFile)) {
  console.log('server/.env already exists, leaving it as is.');
} else {
  writeFileSync(
    envFile,
    `# Local development settings, written by \`npm run setup\`. Not for production.
NODE_ENV=development
PORT=8080
DATABASE_PATH=./data/panel.db

# Fixed token for creating the owner account on a fresh database.
PANEL_SETUP_TOKEN=local-setup-token

# Local stand-in for Discord: "Sign in with Discord" opens a local page where you
# pick who to be. No Discord app needed. Set to false to use a real Discord app.
DEV_DISCORD_LOGIN=true

# Keep username/password sign-in on too.
AUTH_PASSWORD_LOGIN=true

# Connect the built-in mock Palworld server (3 fake players) on first start.
# Point the panel at a real server under Settings > Server connection any time.
DEV_MOCK_SERVER=true

# Public website
SITE_JOIN_ADDRESS=localhost:8211
SITE_DISCORD_INVITE=https://discord.gg/example

# To test with your real Discord application instead of the stand-in:
#   DEV_DISCORD_LOGIN=false
#   DISCORD_CLIENT_ID=
#   DISCORD_CLIENT_SECRET=
#   DISCORD_REDIRECT_URI=http://localhost:5173/api/v1/auth/discord/callback
# and add that redirect under OAuth2 > Redirects in the Discord Developer Portal.

LOG_LEVEL=info
`,
  );
  console.log('Wrote server/.env with local defaults.');
}

console.log(`
Next:
  npm run dev

Then open:
  Public website  http://localhost:5173
  Staff panel     http://localhost:5173/panel   (setup token: local-setup-token)
`);
