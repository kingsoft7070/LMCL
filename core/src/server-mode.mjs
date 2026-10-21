// Mode/configuration rules only; this module does not issue network requests.
const MODES = new Set(['normal', 'server']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Invalid identifier');
  return value;
}

export function serverProvider(config) {
  if (!config || typeof config !== 'object') throw new TypeError('Expected provider configuration');
  const id = identifier(config.id);
  if (typeof config.name !== 'string' || !config.name.trim() || config.name.length > 100 ||
      /[\u0000-\u001f\u007f]/.test(config.name)) throw new TypeError('Invalid provider name');
  if (typeof config.apiRoot !== 'string') throw new TypeError('Missing API root');
  const url = new URL(config.apiRoot);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('API root must use HTTPS without credentials, query or fragment');
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new TypeError('Invalid enabled flag');
  return { id, name: config.name.trim(), apiRoot: url.href.replace(/\/?$/, '/'), enabled: config.enabled ?? true };
}

export function launcherSettings({ mode = 'normal', providers = [] } = {}) {
  if (!MODES.has(mode)) throw new TypeError('Unknown launcher mode');
  if (!Array.isArray(providers)) throw new TypeError('Expected provider array');
  const seen = new Set();
  const entries = providers.map(provider => {
    const entry = serverProvider(provider);
    if (seen.has(entry.id.toLowerCase())) throw new TypeError('Duplicate provider identifier');
    seen.add(entry.id.toLowerCase());
    return entry;
  });
  return { schemaVersion: 1, mode, providers: entries };
}

/** Switching views must retain the rest of the caller's local state. */
export function switchLauncherMode(settings, mode) {
  const validated = launcherSettings({ ...settings, mode });
  return { ...structuredClone(settings), ...validated };
}

/** Only these providers should be polled for the server-mode directory. */
export function directoryProviders(settings) {
  const validated = launcherSettings(settings);
  return validated.mode === 'server' ? validated.providers.filter(provider => provider.enabled) : [];
}

/** Logical identity, not a filesystem path or permission to access a provider. */
export function instanceNamespace(source) {
  if (source?.kind === 'standalone') return JSON.stringify(['standalone', identifier(source.packId)]);
  if (source?.kind === 'server') return JSON.stringify([
    'server', identifier(source.providerId), identifier(source.serverId), identifier(source.packId),
  ]);
  throw new TypeError('Unknown instance source');
}
