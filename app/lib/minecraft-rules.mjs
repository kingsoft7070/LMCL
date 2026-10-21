import path from 'node:path';
import os from 'node:os';
import { portablePath } from '../../core/src/sync-plan.mjs';

export const minecraftOS = platform => ({ win32: 'windows', darwin: 'osx', linux: 'linux' })[platform];

export function inside(root, relative) {
  portablePath(relative);
  return path.join(root, ...relative.split('/'));
}

export function allowed(rules, platform = process.platform, arch = process.arch, features = {}) {
  if (!rules) return true;
  let result = false;
  for (const rule of rules) {
    const target = rule.os;
    if (target?.name && target.name !== minecraftOS(platform)) continue;
    const javaArch = arch === 'x64' ? 'x86_64' : arch === 'ia32' ? 'x86' : arch;
    if (target?.arch && !new RegExp(target.arch).test(javaArch)) continue;
    if (target?.version && !new RegExp(target.version).test(os.release())) continue;
    if (Object.entries(rule.features ?? {}).some(([key, value]) => (features[key] ?? false) !== value)) continue;
    result = rule.action === 'allow';
  }
  return result;
}

export function libraryPlan(metadata, platform = process.platform, arch = process.arch) {
  const artifacts = [], natives = [];
  for (const library of metadata.libraries ?? []) {
    if (!allowed(library.rules, platform, arch)) continue;
    if (library.downloads?.artifact) {
      artifacts.push(library.downloads.artifact);
      if (/-natives-(windows|linux|macos|osx)/.test(library.name ?? '')) natives.push(library.downloads.artifact);
    }
    const classifier = library.natives?.[minecraftOS(platform)]?.replace('${arch}', arch === 'ia32' ? '32' : '64');
    if (classifier) {
      const native = library.downloads?.classifiers?.[classifier];
      if (!native) throw new Error(`缺少当前系统的原生库：${library.name}`);
      natives.push(native);
    }
  }
  return { artifacts, natives };
}

export function expandArguments(entries, values, platform = process.platform, arch = process.arch) {
  const out = [];
  for (const item of entries ?? []) {
    if (typeof item !== 'string' && !allowed(item.rules, platform, arch)) continue;
    const value = typeof item === 'string' ? item : item.value;
    for (const argument of Array.isArray(value) ? value : [value]) {
      if (typeof argument !== 'string') throw new Error('游戏启动参数格式无效');
      out.push(argument.replace(/\$\{([^}]+)\}/g, (_, key) => {
        if (!(key in values)) throw new Error(`暂不支持此版本的启动参数：${key}`);
        return String(values[key]);
      }));
    }
  }
  return out;
}

export function launchArguments(metadata, { root, profile, memoryMB = 4096, platform = process.platform, arch = process.arch }) {
  if (metadata.inheritsFrom) throw new Error('这版暂不支持导入的加载器继承配置，请先使用原版实例');
  if (!Number.isInteger(memoryMB) || memoryMB < 1024 || memoryMB > 32768) throw new Error('内存范围为 1024–32768 MB');
  if (!metadata.arguments || !metadata.mainClass) throw new Error('当前仅支持 1.13 及更新版本的标准原版配置');
  const { artifacts } = libraryPlan(metadata, platform, arch);
  const separator = platform === 'win32' ? ';' : ':';
  const classpath = [...artifacts.map(file => inside(root, `libraries/${file.path}`)),
    inside(root, `versions/${metadata.id}/${metadata.id}.jar`)].join(separator);
  const values = {
    auth_player_name: profile.name, auth_uuid: profile.uuid.replaceAll('-', ''), auth_access_token: '0',
    user_type: 'legacy', user_properties: '{}', version_name: metadata.id, version_type: metadata.type ?? 'release',
    game_directory: root, assets_root: path.join(root, 'assets'), assets_index_name: metadata.assetIndex?.id ?? metadata.assets,
    natives_directory: path.join(root, 'natives'), launcher_name: 'LMCL', launcher_version: '0.1.0-preview.1',
    classpath, classpath_separator: separator, library_directory: path.join(root, 'libraries'),
    auth_xuid: '', clientid: '',
  };
  const jvm = expandArguments(metadata.arguments.jvm, values, platform, arch);
  const args = [`-Xmx${memoryMB}M`, ...jvm];
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) args.push('-cp', classpath);
  if (metadata.logging?.client?.file?.id) {
    const loggingPath = inside(root, `assets/log_configs/${metadata.logging.client.file.id}`);
    args.push(metadata.logging.client.argument.replace('${path}', loggingPath));
  }
  args.push(metadata.mainClass, ...expandArguments(metadata.arguments.game, values, platform, arch));
  return args;
}
