import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../packages/db/migrations/0009_storyboard_continuity_prompt_v3.sql',
    import.meta.url,
  ),
  'utf8',
);
const execution = readFileSync(new URL('../src/editorial/execution.ts', import.meta.url), 'utf8');

describe('Storyboard prompt v3 runtime contract', () => {
  it('communicates deterministic collision-free continuity identities', () => {
    expect(migration).toContain('Every output scene must use a non-null continuityKey');
    expect(migration).toContain(
      'derived solely and deterministically from its contiguous positive order',
    );
    expect(migration).toContain('scene-01 through scene-09');
    expect(migration).toContain('scene-10 for order 10');
    expect(migration).toContain('globally unique across the complete Storyboard');
    expect(migration).toContain(
      'continuityReferenceKeys may contain only exact continuityKey values',
    );
    expect(migration).toContain('Do not reuse a continuityKey to represent recurring characters');
    expect(migration).toContain('record that recurring information in continuityNotes');
    expect(migration).toContain('Do not alter authoritative narration or script-segment linkage');
    expect(migration).toContain('must not be treated as automatically approved');
  });

  it('retains highest-active prompt selection and Storyboard V2 schemas', () => {
    expect(execution).toContain('ORDER BY pv.version_number DESC LIMIT 1');
    expect(migration).toContain("'prompt_version_storyboard_v3','prompt_storyboard_planner',3");
    expect(migration).toContain("'storyboard-input-v2','storyboard-output-v2','active'");
    expect(migration).not.toContain('UPDATE prompt_versions');
    expect(migration).not.toContain('ALTER TABLE');
  });
});
