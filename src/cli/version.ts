import * as fs from 'node:fs';

export function runVersion(): void {
  const pkgPath = new URL('../../package.json', import.meta.url);
  let version = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    version = pkg.version || 'unknown';
  } catch {}
  console.log('hannah-agent-runtime v' + version);
}
