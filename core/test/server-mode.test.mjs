import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launcherSettings, switchLauncherMode, directoryProviders, serverProvider, instanceNamespace } from '../src/server-mode.mjs';
import { planUpdate } from '../src/sync-plan.mjs';

const provider = { id: 'example-community', name: 'Example', apiRoot: 'https://servers.example.org/lmcl/' };

test('public defaults have no server dependency or built-in providers', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../examples/launcher-settings.json', import.meta.url)));
  assert.deepEqual(launcherSettings(), fixture);
  assert.deepEqual(directoryProviders(launcherSettings()), []);
  assert.deepEqual(directoryProviders(launcherSettings({ mode: 'server' })), []);
});

test('standalone pack planning requires no server fields', () => {
  const target = { releaseId: 'r1', files: [{
    path: 'mods/example.jar', sha256: 'a'.repeat(64), size: 10,
    urls: ['https://downloads.example.org/example.jar'], policy: 'managed',
  }] };
  const result = planUpdate({ target, inventory: [] });
  assert.equal(result.canApply, true);
  assert.equal(result.downloads.length, 1);
  assert.equal(instanceNamespace({ kind: 'standalone', packId: 'my-pack' }), '["standalone","my-pack"]');
});

test('mode switch retains accounts, instances and in-progress downloads without mutating caller', () => {
  const original = { ...launcherSettings({ providers: [provider] }),
    accounts: [{ id: 'local-player' }], instances: [{ id: 'my-pack' }],
    downloads: [{ id: 'task-1', progress: 0.5 }],
  };
  const before = structuredClone(original);
  const switched = switchLauncherMode(original, 'server');
  assert.deepEqual(original, before);
  assert.deepEqual(switched.accounts, original.accounts);
  assert.deepEqual(switched.instances, original.instances);
  assert.deepEqual(switched.downloads, original.downloads);
  assert.deepEqual(switchLauncherMode(switched, 'normal'), original);
});

test('normal mode polls no directory and server mode selects only enabled providers', () => {
  const settings = launcherSettings({ providers: [provider, { ...provider, id: 'disabled', enabled: false }] });
  assert.deepEqual(directoryProviders(settings), []);
  const selected = directoryProviders(switchLauncherMode(settings, 'server'));
  assert.deepEqual(selected.map(entry => entry.id), ['example-community']);
  selected[0].name = 'changed';
  assert.equal(settings.providers[0].name, 'Example');
});

test('identical pack/server IDs at different providers never alias standalone or other server instances', () => {
  const source = { kind: 'server', providerId: 'one', serverId: 'survival', packId: 'client' };
  const keys = [source, { ...source, providerId: 'two' }, { ...source, serverId: 'creative' },
    { kind: 'standalone', packId: 'client' }].map(instanceNamespace);
  assert.equal(new Set(keys).size, 4);
});

test('registration rejects credentials, HTTP, query tokens and ambiguous provider IDs', () => {
  for (const apiRoot of ['http://example.org/', 'https://user:pass@example.org/',
    'https://example.org/?token=secret', 'https://example.org/#secret']) {
    assert.throws(() => serverProvider({ ...provider, apiRoot }));
  }
  assert.throws(() => launcherSettings({ providers: [provider, { ...provider, id: 'EXAMPLE-COMMUNITY' }] }));
  assert.throws(() => switchLauncherMode(launcherSettings(), 'lid'));
  assert.throws(() => instanceNamespace({ kind: 'server', providerId: '../one', serverId: 's', packId: 'p' }));
});

test('third-party example uses the same provider format', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../examples/server-provider.json', import.meta.url)));
  assert.deepEqual(serverProvider(fixture), fixture);
});
