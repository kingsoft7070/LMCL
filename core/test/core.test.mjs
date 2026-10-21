import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_PROVIDERS, createOfflineProfile, bedrockLaunchIntent } from '../src/accounts.mjs';
import { portablePath, planUpdate } from '../src/sync-plan.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const file = (path, sha256 = A, policy = 'managed') => ({ path, sha256, size: 10, policy, urls: ['https://example.com/file'] });
const local = (entry, sha256 = entry.sha256) => ({ path: entry.path, sha256, size: entry.size, kind: 'file' });
const release = (files, releaseId = 'r1') => ({ releaseId, files });
const plan = (before, after, inventory, gameRunning = false) => planUpdate({
  previous: release(before), target: release(after, 'r2'), inventory, gameRunning,
});

test('three selectable providers retain recommendation order', () => {
  assert.deepEqual(ACCOUNT_PROVIDERS.map(x => x.id), ['microsoft', 'littleskin', 'offline']);
});

test('offline identity matches known Java UUID and preserves case', () => {
  assert.equal(createOfflineProfile('Notch').uuid, 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.notEqual(createOfflineProfile('Notch').uuid, createOfflineProfile('notch').uuid);
  assert.equal(createOfflineProfile('Notch').verified, false);
  for (const name of ['', 'Player Name', 'a'.repeat(17), '../admin']) assert.throws(() => createOfflineProfile(name));
});

test('Bedrock produces fixed Windows URI intent without executing shell', () => {
  assert.equal(bedrockLaunchIntent('win32').uri, 'minecraft://');
  assert.throws(() => bedrockLaunchIntent('darwin'));
});

test('incremental update installs new, repairs missing and removes retired managed file', () => {
  const old = file('mods/old.jar'), keep = file('mods/keep.jar'), missing = file('mods/missing.jar');
  const added = file('mods/new.jar');
  const result = plan([old, keep, missing], [keep, missing, added], [local(old), local(keep)]);
  assert.deepEqual(result.removals, ['mods/old.jar']);
  assert.deepEqual(result.unchanged, ['mods/keep.jar']);
  assert.deepEqual(result.downloads.map(x => x.path), ['mods/missing.jar', 'mods/new.jar']);
  assert.equal(result.downloadBytes, 20);
  assert.equal(result.canApply, true);
});

test('modified managed and unowned colliding files require conflict resolution', () => {
  const old = file('mods/a.jar'), next = file('mods/a.jar', B);
  assert.equal(plan([old], [next], [local(old, C)]).conflicts[0].reason, 'modified-managed-file');
  assert.equal(plan([], [next], [local(old)]).conflicts[0].reason, 'unmanaged-collision');
});

test('user configuration changes and saves survive update', () => {
  const old = file('config/options.json', A, 'user-editable');
  const next = file(old.path, B, 'user-editable');
  const save = { path: 'saves/My World/level.dat', kind: 'file', sha256: C, size: 100 };
  const result = plan([old], [next], [local(old, C), save]);
  assert.equal(result.preserved[0].reason, 'user-edited-config');
  assert.equal(result.downloads.length, 0);
  assert.deepEqual(result.removals, []);
  assert.deepEqual(result.conflicts, []);
});

test('unchanged default config upgrades but retired user config is preserved', () => {
  const old = file('config/options.json', A, 'user-editable');
  assert.equal(plan([old], [file(old.path, B, old.policy)], [local(old)]).downloads.length, 1);
  assert.equal(plan([old], [], [local(old)]).preserved[0].reason, 'retired-user-config');
});

test('modified retired file is never scheduled for deletion', () => {
  const old = file('mods/a.jar');
  const result = plan([old], [], [local(old, C)]);
  assert.equal(result.removals.length, 0);
  assert.equal(result.canApply, false);
});

test('running game defers application while allowing a download plan', () => {
  const result = plan([], [file('mods/a.jar')], [], true);
  assert.equal(result.downloads.length, 1);
  assert.equal(result.deferredUntilGameExit, true);
  assert.equal(result.canApply, false);
});

test('Windows traversal, device names, ADS, ambiguous paths and protected data are rejected', () => {
  for (const path of ['/mods/a.jar', '../a.jar', 'mods/../a.jar', 'mods\\a.jar',
    'C:/mods/a.jar', 'mods/a.jar:payload', 'mods/NUL.jar', 'mods/COM1.txt',
    'mods/a.jar.', 'mods/a.jar ', 'mods//a.jar', 'mods/./a.jar', 'mods/evil\u0000.jar']) {
    assert.throws(() => portablePath(path), path);
  }
  assert.throws(() => plan([], [file('saves/world/level.dat')], []));
});

test('Windows case collisions and parent-file collisions fail validation', () => {
  assert.throws(() => plan([], [file('mods/A.jar'), file('mods/a.jar')], []));
  assert.throws(() => plan([], [file('mods/a.jar'), file('mods/a.jar/child')], []));
});

test('symlink parent and non-regular destination block application', () => {
  const target = file('mods/a.jar');
  assert.equal(plan([], [target], [{ path: 'mods', kind: 'symlink' }]).canApply, false);
  assert.equal(plan([], [target], [{ path: target.path, kind: 'directory' }]).canApply, false);
});

test('user-installed mods are retained and surfaced as conflicts', () => {
  const result = plan([], [], [local(file('mods/custom.jar'))]);
  assert.equal(result.conflicts[0].reason, 'unmanaged-mod');
  assert.equal(result.removals.length, 0);
});

test('non-HTTPS downloads, weak hashes and invalid size are rejected', () => {
  for (const change of [{ urls: ['http://example.com/file'] }, { sha256: 'bad' },
    { size: -1 }, { urls: ['https://user:password@example.com/file'] }]) {
    assert.throws(() => plan([], [{ ...file('mods/a.jar'), ...change }], []));
  }
});
