import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const [sha, ...modeArgs] = args;
if (args.length > 2) throw new Error('Too many candidate arguments');
if (!/^[0-9a-f]{40}$/u.test(sha ?? ''))
  throw new Error(
    'Usage: pnpm staging:candidate -- <source-sha> [--openai-operational|--enable-openai-connectivity]',
  );
const modes = {
  default: { providerEnabled: 'false', diagnosticEnabled: 'false' },
  '--openai-operational': { providerEnabled: 'true', diagnosticEnabled: 'false' },
  '--enable-openai-connectivity': { providerEnabled: 'true', diagnosticEnabled: 'true' },
};
const mode = modeArgs[0] ?? 'default';
const flags = modes[mode];
if (flags === undefined) throw new Error('Unsupported candidate mode');
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) throw new Error(command + ' failed');
  return capture ? result.stdout.trim() : '';
}
const head = run('git', ['rev-parse', 'HEAD'], true);
const branch = run('git', ['branch', '--show-current'], true);
const origin = run('git', ['rev-parse', 'origin/main'], true);
const status = run('git', ['status', '--porcelain'], true);
if (branch !== 'main' || head !== sha || origin !== sha || status !== '')
  throw new Error('Requires clean main with HEAD == origin/main == source SHA');
run('pnpm', ['build:web']);
run('pnpm', [
  'exec',
  'wrangler',
  'versions',
  'upload',
  '--config',
  'infra/cloudflare/wrangler.jsonc',
  '--env',
  'staging',
  '--name',
  'vision-maxson-ai-content-studio',
  '--var',
  'RELEASE_VERSION:' + sha,
  '--var',
  'OPENAI_PROVIDER_ENABLED:' + flags.providerEnabled,
  '--var',
  'AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED:' + flags.diagnosticEnabled,
  '--message',
  'staging-candidate-' + sha.slice(0, 7),
  '--tag',
  'staging-' + sha.slice(0, 7),
]);
