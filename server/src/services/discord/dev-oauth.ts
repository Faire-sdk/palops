import { DISCORD_ID_PATTERN } from '../authentication/users.js';
import { DiscordOAuthError, type DiscordOAuthProvider, type DiscordSignIn } from './oauth.js';

/**
 * Local development stand-in for Discord (DEV_DISCORD_LOGIN=true, only with
 * NODE_ENV=development). "Signing in" shows a local page where you type any
 * Discord id and name, so staff and player flows can be tested offline. The
 * rest of the flow (state, callback, sessions) is the real code path.
 */
export class DevDiscordOAuth implements DiscordOAuthProvider {
  authorizeUrl(state: string, _options?: { joinServer?: boolean }): string {
    return `/api/v1/auth/dev-discord?state=${encodeURIComponent(state)}`;
  }

  async exchange(code: string): Promise<DiscordSignIn> {
    let parsed: { id?: unknown; username?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
    } catch {
      throw new DiscordOAuthError('Invalid development sign-in code');
    }
    if (typeof parsed.id !== 'string' || !DISCORD_ID_PATTERN.test(parsed.id)) {
      throw new DiscordOAuthError('Invalid development Discord id');
    }
    const username = typeof parsed.username === 'string' && parsed.username.trim() ? parsed.username.trim().slice(0, 32) : null;
    return { id: parsed.id, username, avatar: null, accessToken: 'dev-access-token' };
  }

  static encode(id: string, username: string): string {
    return Buffer.from(JSON.stringify({ id, username })).toString('base64url');
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The fake "Discord" consent page. */
export function devDiscordPage(state: string): string {
  const personas = [
    ['100000000000000001', 'local_owner', 'Owner (use for first-run setup)'],
    ['100000000000000002', 'local_moderator', 'A staff member'],
    ['100000000000000003', 'lambfan', 'A player'],
  ];
  const buttons = personas
    .map(
      ([id, name, label]) => `<form method="get" action="/api/v1/auth/dev-discord/approve">
        <input type="hidden" name="state" value="${escape(state)}">
        <input type="hidden" name="id" value="${id}"><input type="hidden" name="username" value="${name}">
        <button>${escape(label!)}<small>${name} · ${id}</small></button></form>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local Discord sign-in</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#313338;color:#f2f3f5;font:15px/1.5 system-ui,sans-serif}
  main{width:min(420px,calc(100vw - 32px));background:#2b2d31;border-radius:12px;padding:28px}
  h1{font-size:20px;margin:0 0 4px}p{color:#b5bac1;margin:0 0 18px}
  form{margin:0 0 10px}button{width:100%;text-align:left;background:#5865f2;color:#fff;border:0;border-radius:8px;padding:10px 14px;font:inherit;cursor:pointer}
  button:hover{background:#4752c4}small{display:block;opacity:.75;font-size:12px}
  .custom{border-top:1px solid #3f4147;padding-top:16px;margin-top:16px}
  input[type=text]{width:100%;box-sizing:border-box;margin:0 0 8px;padding:9px 10px;border-radius:6px;border:1px solid #1e1f22;background:#1e1f22;color:#fff;font:inherit}
  .note{font-size:12px;color:#949ba4;margin-top:14px}
</style></head><body><main>
<h1>Local Discord sign-in</h1><p>Development stand-in for Discord. Pick who to sign in as.</p>
${buttons}
<form method="get" action="/api/v1/auth/dev-discord/approve" class="custom">
  <input type="hidden" name="state" value="${escape(state)}">
  <input type="text" name="id" placeholder="Discord user ID (17-20 digits)" pattern="\\d{17,20}" required>
  <input type="text" name="username" placeholder="Username" maxlength="32" required>
  <button>Sign in as someone else</button>
</form>
<p class="note">Enabled by DEV_DISCORD_LOGIN=true. Never available in production.</p>
</main></body></html>`;
}
