import { readFileSync, readdirSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const candidate = readFileSync('scripts/create-staging-candidate.mjs', 'utf8');
const promote = readFileSync('scripts/promote-staging-version.mjs', 'utf8');
if ('deploy:staging' in pkg.scripts) throw new Error('Direct deploy:staging script is forbidden');
if (!pkg.scripts['dry-run:staging'].includes('--dry-run'))
  throw new Error('Staging validation must remain dry-run only');
if (/wrangler\s+(?:versions\s+)?deploy/u.test(workflow)) throw new Error('CI must not deploy');
if (!/'versions'\s*,\s*'upload'/u.test(candidate))
  throw new Error('Candidate must use versions upload');
if (!/'versions'\s*,\s*'deploy'/u.test(promote))
  throw new Error('Promotion must use versions deploy');
console.log('Deployment safety checks passed');
const manifests = ['package.json'];
for (const root of ['apps', 'packages']) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(root + '/' + entry.name + '/package.json');
  }
}
for (const manifest of manifests) {
  const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    if (
      /^(preinstall|postinstall|prebuild|postbuild|pretest|posttest)$/u.test(name) &&
      /wrangler|staging:promote|staging:candidate|deploy:/u.test(command)
    )
      throw new Error('Lifecycle deployment forbidden: ' + manifest + ':' + name);
    if (/^(check|build|build:web|test|lint|typecheck|format:check|dry-run:staging)$/u.test(name)) {
      for (const segment of command.split('&&')) {
        if (/wrangler\s+(?:versions\s+)?deploy/u.test(segment) && !segment.includes('--dry-run'))
          throw new Error('Validation deployment forbidden: ' + manifest + ':' + name);
        if (/staging:promote|staging:candidate|pnpm\s+deploy:/u.test(segment))
          throw new Error('Validation cannot invoke release scripts');
      }
    }
  }
}
