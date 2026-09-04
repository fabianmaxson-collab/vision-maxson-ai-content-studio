import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const [versionId] = args;
if (args.length !== 1) throw new Error('Exactly one authorized Version ID is required');
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(versionId ?? ''))
  throw new Error('Usage: pnpm staging:promote -- <authorized-version-id>');
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'versions',
    'deploy',
    versionId + '@100%',
    '--config',
    'infra/cloudflare/wrangler.jsonc',
    '--env',
    'staging',
    '--name',
    'vision-maxson-ai-content-studio',
    '--message',
    'promote-authorized-staging-' + versionId,
    '--yes',
  ],
  { shell: process.platform === 'win32', stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
