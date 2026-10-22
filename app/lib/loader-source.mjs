import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { mavenArtifactPath } from '../../core/src/loader-install-plan.mjs';

const TRUSTED = new Set(['meta.fabricmc.net', 'maven.fabricmc.net', 'meta.quiltmc.org', 'maven.quiltmc.org']);
const META = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
};

function trusted(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !TRUSTED.has(url.hostname)) {
    throw new Error('加载器来源不在可信官方域名内');
  }
  return url.href;
}
async function response(url, { signal, method = 'GET' } = {}) {
  const res = await fetch(trusted(url), { method, signal, redirect: 'error', headers: { 'User-Agent': 'LMCL/0.2.0' } });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`加载器请求失败（HTTP ${res.status}）`); }
  return res;
}
async function json(url, signal, limit = 8 * 1024 * 1024) {
  const res = await response(url, { signal });
  let size = 0; const chunks = [];
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw new Error('加载器元数据过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function loaderVersions(loader, minecraftVersion, signal) {
  if (!META[loader]) throw new Error('仅支持 Fabric 或 Quilt');
  const list = await json(`${META[loader]}/versions/loader/${encodeURIComponent(minecraftVersion)}`, signal);
  if (!Array.isArray(list) || list.length > 1000) throw new Error('加载器版本列表格式错误');
  return list.map(item => ({
    version: item?.loader?.version,
    stable: item?.loader?.stable !== false && !String(item?.loader?.version ?? '').includes('beta'),
  })).filter(item => typeof item.version === 'string' && item.version.length < 100);
}

async function supplementLibrary(library, signal) {
  const result = structuredClone(library);
  const artifactPath = mavenArtifactPath(result.name);
  const root = String(result.url ?? '').replace(/\/+$/, '') + '/';
  const artifactUrl = result.downloads?.artifact?.url ?? new URL(artifactPath, root).href;
  trusted(artifactUrl);
  result.url = root;

  let sha1 = result.sha1 ?? result.downloads?.artifact?.sha1;
  let size = result.size ?? result.downloads?.artifact?.size;
  if (!sha1) {
    const shaResponse = await response(`${artifactUrl}.sha1`, { signal });
    const text = (await shaResponse.text()).trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/i.test(text)) throw new Error(`加载器库缺少可信 SHA-1：${result.name}`);
    sha1 = text.toLowerCase();
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    const head = await response(artifactUrl, { signal, method: 'HEAD' });
    size = Number(head.headers.get('content-length'));
    if (!Number.isSafeInteger(size) || size < 0 || size > 2 ** 31) throw new Error(`加载器库大小无效：${result.name}`);
  }
  result.sha1 = sha1;
  result.size = size;
  return result;
}

export async function loaderProfile(loader, minecraftVersion, loaderVersion, signal) {
  if (!META[loader]) throw new Error('仅支持 Fabric 或 Quilt');
  const url = `${META[loader]}/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile = await json(url, signal);
  if (!profile || profile.inheritsFrom !== minecraftVersion || !Array.isArray(profile.libraries)) {
    throw new Error('加载器 Profile 格式错误');
  }
  profile.loader = loader;
  profile.loaderVersion = loaderVersion;
  profile.minecraftVersion = minecraftVersion;
  profile.libraries = await Promise.all(profile.libraries.map(lib => supplementLibrary(lib, signal)));
  return profile;
}

export async function downloadLoaderArtifact(file, destination, signal, onProgress) {
  const res = await response(file.url, { signal });
  const out = createWriteStream(destination, { flags: 'wx' });
  let done = 0;
  const source = typeof res.body?.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      done += chunk.length;
      onProgress?.({ bytes: done, totalBytes: file.size });
      callback(null, chunk);
    }
  });
  await pipeline(source, progress, out, { signal });
}
