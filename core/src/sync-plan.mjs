// Pure planning prototype. No file operations, download, signature verification,
// or trust decision happens here. Inventory hashes must describe actual bytes.
const ROOTS = new Set(['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'kubejs', 'scripts']);
const HASH = /^[a-f0-9]{64}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

export function portablePath(value) {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC')) {
    throw new TypeError('Expected an NFC relative path');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' ||
      /[\\<>:"|?*\u0000-\u001f\u007f]/.test(part) || /[. ]$/.test(part) || RESERVED.test(part))) {
    throw new TypeError(`Unsafe Windows path: ${value}`);
  }
  return value;
}

function key(path) { return portablePath(path).toLowerCase(); }

function indexFiles(files, manifest) {
  if (!Array.isArray(files)) throw new TypeError('Expected file array');
  const indexed = new Map();
  for (const file of files) {
    if (!file || typeof file !== 'object') throw new TypeError('Invalid file');
    const id = key(file.path);
    if (indexed.has(id)) throw new TypeError(`Case-colliding path: ${file.path}`);
    if (manifest) {
      if (!ROOTS.has(file.path.split('/')[0]) || !file.path.includes('/')) {
        throw new TypeError(`Not a pack-managed path: ${file.path}`);
      }
      if (!['managed', 'user-editable'].includes(file.policy)) throw new TypeError('Invalid policy');
      if (!HASH.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) {
        throw new TypeError('Invalid file hash or size');
      }
      if (!Array.isArray(file.urls) || !file.urls.length) throw new TypeError('Missing download source');
      for (const url of file.urls) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
          throw new TypeError('Download sources must use HTTPS without embedded credentials');
        }
      }
    } else {
      if (!['file', 'directory', 'symlink'].includes(file.kind)) throw new TypeError('Invalid inventory kind');
      if (file.kind === 'file' && (!HASH.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0)) {
        throw new TypeError('Inventory needs actual SHA-256 and size');
      }
    }
    indexed.set(id, structuredClone(file));
  }
  for (const id of indexed.keys()) {
    const parts = id.split('/');
    for (let end = 1; end < parts.length; end++) {
      const ancestor = indexed.get(parts.slice(0, end).join('/'));
      if (ancestor && (manifest || ancestor.kind !== 'directory')) {
        throw new TypeError(`File/symlink used as a directory: ${id}`);
      }
    }
  }
  return indexed;
}

function releaseFiles(release) {
  if (!release || typeof release.releaseId !== 'string' || !release.releaseId.trim()) {
    throw new TypeError('Missing releaseId');
  }
  return indexFiles(release.files, true);
}

const same = (a, b) => a?.sha256 === b?.sha256 && a?.size === b?.size;

/** Returns decisions only. Validate trust, permissions and disk state in executor. */
export function planUpdate({ previous = null, target, inventory, gameRunning = false }) {
  if (typeof gameRunning !== 'boolean') throw new TypeError('gameRunning must be boolean');
  const before = previous ? releaseFiles(previous) : new Map();
  const after = releaseFiles(target);
  const actual = indexFiles(inventory, false);
  const plan = { releaseId: target.releaseId, downloads: [], removals: [], preserved: [], unchanged: [], conflicts: [] };
  for (const [id, wanted] of after) {
    const current = actual.get(id);
    const old = before.get(id);
    const parts = id.split('/');
    const blockedParent = parts.slice(0, -1).some((_, i) => {
      const ancestor = actual.get(parts.slice(0, i + 1).join('/'));
      return ancestor && ancestor.kind !== 'directory';
    });
    if (blockedParent || (current && current.kind !== 'file')) {
      plan.conflicts.push({ path: wanted.path, reason: 'non-regular-path' });
    } else if (current && same(current, wanted)) {
      plan.unchanged.push(wanted.path);
    } else if (current && wanted.policy === 'user-editable' && (!old || !same(current, old))) {
      plan.preserved.push({ path: current.path, reason: 'user-edited-config' });
    } else if (current && (!old || !same(current, old))) {
      plan.conflicts.push({ path: current.path, reason: old ? 'modified-managed-file' : 'unmanaged-collision' });
    } else {
      plan.downloads.push({ ...wanted, reason: current ? 'changed' : 'missing' });
    }
  }
  for (const [id, old] of before) {
    if (after.has(id)) continue;
    const current = actual.get(id);
    if (!current) continue;
    if (old.policy === 'user-editable') {
      plan.preserved.push({ path: current.path, reason: 'retired-user-config' });
    } else if (current.kind !== 'file' || !same(current, old)) {
      plan.conflicts.push({ path: current.path, reason: 'modified-retired-file' });
    } else {
      plan.removals.push(old.path);
    }
  }
  for (const [id, current] of actual) {
    if (id.startsWith('mods/') && current.kind !== 'directory' && !before.has(id) && !after.has(id)) {
      plan.conflicts.push({ path: current.path, reason: 'unmanaged-mod' });
    }
  }
  plan.downloadBytes = plan.downloads.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(plan.downloadBytes)) throw new TypeError('Download size overflow');
  plan.deferredUntilGameExit = gameRunning && (plan.downloads.length > 0 || plan.removals.length > 0);
  plan.canApply = !plan.conflicts.length && !gameRunning;
  return plan;
}
