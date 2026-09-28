import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('treats blank values from .env.example as unset', () => {
    const example = parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));
    const config = loadConfig({ ...example, NODE_ENV: 'production', PANEL_SECRET: 'x'.repeat(64) });
    expect(config.discord).toBeNull();
    expect(config.passwordLogin).toBe(true);
    expect(config.setupToken).toBeUndefined();
    expect(config.site.discordInvite).toBeNull();
  });

  it('still requires PANEL_SECRET in production when it is blank', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PANEL_SECRET: '' })).toThrow(/PANEL_SECRET/);
  });
});
