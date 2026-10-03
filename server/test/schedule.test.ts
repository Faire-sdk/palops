import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextRestart, restartMinutes, type ScheduleSettingsInput } from '../src/services/schedule/schedule-service.js';
import type { Services } from '../src/services/index.js';
import { api, createTestApp, loginAs } from './helpers.js';

const settings: ScheduleSettingsInput = {
  restartEnabled: true,
  restartEveryHours: 4,
  restartAt: '00:00',
  restartWarnMinutes: 5,
  restartMessage: '',
  saveEnabled: false,
  saveEveryMinutes: 15,
};

describe('restart times', () => {
  it('repeats from the first restart of the day', () => {
    expect(restartMinutes(4, '00:00')).toEqual([0, 240, 480, 720, 960, 1200]);
    expect(restartMinutes(6, '03:30')).toEqual([210, 570, 930, 1290]);
    // 5 doesn't divide 24, so the day restarts from 02:00.
    expect(restartMinutes(5, '02:00')).toEqual([120, 420, 720, 1020, 1320]);
    expect(restartMinutes(24, '04:00')).toEqual([240]);
  });

  it('finds the next one, including tomorrow', () => {
    expect(nextRestart(4, '00:00', new Date(2026, 9, 3, 9, 15))).toEqual(new Date(2026, 9, 3, 12, 0));
    expect(nextRestart(4, '00:00', new Date(2026, 9, 3, 12, 0))).toEqual(new Date(2026, 9, 3, 16, 0));
    expect(nextRestart(4, '00:00', new Date(2026, 9, 3, 21, 0))).toEqual(new Date(2026, 9, 4, 0, 0));
    expect(nextRestart(24, '04:00', new Date(2026, 9, 3, 5, 0))).toEqual(new Date(2026, 9, 4, 4, 0));
  });
});

describe('ScheduleService', () => {
  let services: Services;

  beforeEach(async () => {
    ({ services } = await createTestApp());
    services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
    services.palworld.mock.start();
  });

  it('starts the game’s shutdown countdown when the warning window opens, once', async () => {
    services.schedule.saveSettings(settings);
    const shutdown = vi.spyOn(services.palworld.mock, 'shutdown');

    await services.schedule.tick(new Date(2026, 9, 3, 11, 54));
    expect(shutdown).not.toHaveBeenCalled();

    await services.schedule.tick(new Date(2026, 9, 3, 11, 55));
    expect(shutdown).toHaveBeenCalledWith(300, 'Scheduled restart in 5 minutes. Find a safe spot!');

    services.palworld.mock.start();
    await services.schedule.tick(new Date(2026, 9, 3, 11, 58));
    await services.schedule.tick(new Date(2026, 9, 3, 12, 0, 30));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(services.schedule.getStatus(new Date(2026, 9, 3, 12, 1)).nextRestartAt).toBe(new Date(2026, 9, 3, 16, 0).toISOString());
  });

  it('uses the custom message and skips a slot it missed', async () => {
    services.schedule.saveSettings({ ...settings, restartMessage: 'Back in a moment ({minutes} min)' });
    const shutdown = vi.spyOn(services.palworld.mock, 'shutdown');

    // The panel was down at 12:00 and comes back at 12:10: no late restart.
    await services.schedule.tick(new Date(2026, 9, 3, 12, 10));
    expect(shutdown).not.toHaveBeenCalled();

    await services.schedule.tick(new Date(2026, 9, 3, 15, 57));
    expect(shutdown).toHaveBeenCalledWith(180, 'Back in a moment (3 min)');
  });

  it('records an error when the server is down at restart time', async () => {
    services.schedule.saveSettings(settings);
    await services.palworld.mock.forceStop();
    await services.schedule.tick(new Date(2026, 9, 3, 11, 56));
    expect(services.schedule.getStatus().lastError?.message).toMatch(/^Scheduled restart skipped/);
  });

  it('saves the world on its interval', async () => {
    services.schedule.saveSettings({ ...settings, restartEnabled: false, saveEnabled: true, saveEveryMinutes: 10 });
    const save = vi.spyOn(services.palworld.mock, 'save');
    const start = new Date(2026, 9, 3, 9, 0);

    await services.schedule.tick(start);
    await services.schedule.tick(new Date(start.getTime() + 9 * 60_000));
    expect(save).not.toHaveBeenCalled();
    await services.schedule.tick(new Date(start.getTime() + 10 * 60_000));
    expect(save).toHaveBeenCalledTimes(1);
    expect(services.schedule.getStatus().lastSaveAt).toBe(new Date(start.getTime() + 10 * 60_000).toISOString());
  });

  it('does nothing while restarts and saves are off (the default for restarts)', async () => {
    expect(services.schedule.getSettings()).toMatchObject({ restartEnabled: false, restartEveryHours: 4, saveEnabled: true, saveEveryMinutes: 15 });
    const shutdown = vi.spyOn(services.palworld.mock, 'shutdown');
    await services.schedule.tick(new Date(2026, 9, 3, 23, 58));
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe('schedule API', () => {
  it('lets viewers read it and admins change it', async () => {
    const { app, services } = await createTestApp();
    const viewer = await loginAs(app, services, 'viewer');
    const admin = await loginAs(app, services, 'admin');

    const read = await api(app, { method: 'GET', url: '/api/v1/server/schedule', cookie: viewer });
    expect(read.statusCode).toBe(200);
    expect(read.json().settings.restartEnabled).toBe(false);

    const denied = await api(app, { method: 'PUT', url: '/api/v1/server/schedule', cookie: viewer, payload: settings });
    expect(denied.statusCode).toBe(403);

    const bad = await api(app, { method: 'PUT', url: '/api/v1/server/schedule', cookie: admin, payload: { ...settings, restartAt: '25:00' } });
    expect(bad.statusCode).toBe(400);

    const saved = await api(app, { method: 'PUT', url: '/api/v1/server/schedule', cookie: admin, payload: settings });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject({ restartEnabled: true, restartEveryHours: 4 });
    expect(saved.json().status.nextRestartAt).toBeTruthy();
  });
});
