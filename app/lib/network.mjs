import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const OFFICIAL = new Set(['piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com',
  'launcher.mojang.com', 'libraries.minecraft.net', 'resources.download.minecraft.net']);

export function officialURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !OFFICIAL.has(url.hostname)) {
    throw new Error('游戏文件来源不在允许的官方域名内');
  }
  return url.href;
}

async function responseFor(url, signal, official) {
  let current = official ? officialURL(url) : url;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(current, { signal, redirect: 'manual', headers: { 'User-Agent': 'LMCL/0.1.0-preview.2' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (!official) throw new Error('服务器接口发生重定向，请检查接口地址');
      current = officialURL(new URL(response.headers.get('location'), current));
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`请求失败（HTTP ${response.status}）`); }
    return response;
  }
  throw new Error('下载重定向次数过多');
}

export async function getJSON(url, { signal, official = false, sha1, limit = 8 * 1024 * 1024 } = {}) {
  const timed = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const response = await responseFor(url, timed, official);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('服务器返回的数据过大');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (sha1 && createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('版本信息校验失败');
  return JSON.parse(bytes.toString('utf8'));
}

async function digest(filename) {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function download(file, destination, signal) {
  if (!/^[a-f0-9]{40}$/.test(file.sha1) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 2 ** 31) {
    throw new Error('下载清单的哈希或文件大小无效');
  }
  officialURL(file.url);
  try {
    if ((await stat(destination)).size === file.size && await digest(destination) === file.sha1) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.part`;
  const handle = await open(temporary, 'wx');
  try {
    const response = await responseFor(file.url, AbortSignal.any([signal, AbortSignal.timeout(180000)]), true);
    const hash = createHash('sha1');
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > file.size) throw new Error('下载内容超出预期大小');
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (length !== file.size || hash.digest('hex') !== file.sha1) throw new Error('文件校验失败，请重试');
    await handle.close();
    await rename(temporary, destination);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function downloadQueue(files, signal, onProgress) {
  let next = 0, done = 0;
  let failure;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const workers = Array.from({ length: Math.min(10, files.length) }, async () => {
    try {
      while (next < files.length && !combined.aborted) {
        const file = files[next++];
        await download(file, file.destination, combined);
        onProgress?.({ done: ++done, total: files.length });
      }
    } catch (error) { failure ??= error; controller.abort(); }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  combined.throwIfAborted();
}
