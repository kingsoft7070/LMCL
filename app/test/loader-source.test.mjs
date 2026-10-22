import test from 'node:test';
import assert from 'node:assert/strict';
import { loaderVersions, loaderProfile, downloadLoaderArtifact } from '../lib/loader-source.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sha = 'a'.repeat(40);
function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test('loader version list accepts trusted Fabric metadata and rejects untrusted redirects', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).hostname, 'meta.fabricmc.net');
    return response(JSON.stringify([{ loader: { version: '0.18.0', stable: true } }]));
  };
  try { assert.deepEqual(await loaderVersions('fabric', '1.20.1'), [{ version: '0.18.0', stable: true }]); }
  finally { globalThis.fetch = old; }
});

test('loader profile supplements missing SHA-1 and size from trusted Maven', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/profile/json')) return response(JSON.stringify({
      id: 'fabric-loader-0.18.0-1.20.1', inheritsFrom: '1.20.1', mainClass: 'Loader', arguments: { game: [], jvm: [] },
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.18.0', url: 'https://maven.fabricmc.net/' }]
    }));
    if (String(url).endsWith('.sha1')) return response(sha);
    if (init.method === 'HEAD') return response('', { headers: { 'content-length': '123' } });
    throw new Error(`unexpected ${url}`);
  };
  try {
    const profile = await loaderProfile('fabric', '1.20.1', '0.18.0');
    assert.equal(profile.loader, 'fabric');
    assert.equal(profile.libraries[0].sha1, sha);
    assert.equal(profile.libraries[0].size, 123);
  } finally { globalThis.fetch = old; }
});

test('artifact downloader writes the bounded trusted response', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lmcl-loader-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'loader.jar');
  const old = globalThis.fetch;
  globalThis.fetch = async () => response(Buffer.from('abc'));
  try {
    await downloadLoaderArtifact({ url: 'https://maven.fabricmc.net/test.jar', size: 3 }, target, new AbortController().signal);
    assert.equal(await readFile(target, 'utf8'), 'abc');
  } finally { globalThis.fetch = old; }
});
