import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production boot configuration', () => {
  it('deduplicates React and ReactDOM so hooks share one dispatcher', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(config).toContain("dedupe: ['react', 'react-dom']");
  });

  it('starts with the Spanish document locale', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<html lang="es">');
  });
});
