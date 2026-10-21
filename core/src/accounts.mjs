import { createHash } from 'node:crypto';

export const ACCOUNT_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'microsoft', label: '微软正版登录', rank: 0, mode: 'web-authorization' }),
  Object.freeze({ id: 'littleskin', label: 'LittleSkin 登录', rank: 1,
    mode: 'yggdrasil', apiRoot: 'https://littleskin.cn/api/yggdrasil' }),
  Object.freeze({ id: 'offline', label: '离线登录', rank: 2, mode: 'local-profile' }),
]);

/** Java UUID.nameUUIDFromBytes on the exact, case-sensitive UTF-8 name. */
export function createOfflineProfile(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    throw new TypeError('角色名需为 1–16 位英文字母、数字或下划线');
  }
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return Object.freeze({ provider: 'offline', name, uuid, verified: false });
}

/** Returns intent only. A Windows adapter must check launch result. */
export function bedrockLaunchIntent(platform) {
  if (platform !== 'win32') throw new Error('基岩版工具按钮首版仅支持 Windows');
  return Object.freeze({ action: 'open-uri', uri: 'minecraft://', requiresInstalledHandler: true });
}
