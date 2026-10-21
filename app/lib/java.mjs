import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
const run = promisify(execFile);

export async function inspectJava(executable) {
  const { stdout, stderr } = await run(executable, ['-version'], { timeout: 7000, windowsHide: true });
  const text = `${stdout}\n${stderr}`;
  const match = text.match(/(?:openjdk|java) version "(?:1\.)?(\d+)/i);
  if (!match) throw new Error('无法识别该 Java 版本');
  return { path: executable, major: Number(match[1]), description: text.trim().split('\n')[0] };
}

export async function discoverJava(selected = '') {
  const candidates = new Set(selected ? [selected] : []);
  if (process.env.JAVA_HOME) candidates.add(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  candidates.add('java');
  if (process.platform === 'win32') {
    for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto']) {
      const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', vendor);
      for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) candidates.add(path.join(root, entry.name, 'bin', 'java.exe'));
      }
    }
  }
  const found = [];
  for (const candidate of candidates) {
    try { found.push(await inspectJava(candidate)); } catch { /* Other installed Javas may still work. */ }
  }
  return found;
}
