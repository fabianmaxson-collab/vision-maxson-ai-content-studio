import { describe, expect, it } from 'vitest';
import { contentBriefHumanRevisionSchema, contentBriefSchema } from './editorial';
const valid = {
  expectedArtifactRevision: 4,
  changes: {
    objective: 'Objective',
    narrativeAngle: 'Angle',
    hook: 'Hook',
    visualDirection: 'Visual',
    editorialConstraints: ['Constraint'],
  },
};
describe('Content Brief human revision strict contract', () => {
  it('accepts exactly the five corrections and positive CAS revision', () =>
    expect(contentBriefHumanRevisionSchema.parse(valid)).toEqual(valid));
  it.each([
    'actor',
    'role',
    'artifactId',
    'researchVersionIds',
    'ideaVersionId',
    'sourceType',
    'versionNumber',
    'content',
    'extra',
  ])('rejects injected %s', (field) => {
    expect(
      contentBriefHumanRevisionSchema.safeParse({ ...valid, [field]: 'injected' }).success,
    ).toBe(false);
    expect(
      contentBriefHumanRevisionSchema.safeParse({
        ...valid,
        changes: { ...valid.changes, [field]: 'injected' },
      }).success,
    ).toBe(false);
  });
  it.each(Object.keys(valid.changes))('requires %s', (key) => {
    const changes = { ...valid.changes } as Record<string, unknown>;
    delete changes[key];
    expect(contentBriefHumanRevisionSchema.safeParse({ ...valid, changes }).success).toBe(false);
  });
  it.each([0, -1, 1.5, '4', null])('rejects revision %s', (revision) =>
    expect(
      contentBriefHumanRevisionSchema.safeParse({ ...valid, expectedArtifactRevision: revision })
        .success,
    ).toBe(false),
  );
  it.each([
    ['objective', 1000],
    ['narrativeAngle', 4000],
    ['hook', 4000],
    ['visualDirection', 8000],
  ] as const)('enforces %s bound', (field, max) => {
    for (const value of ['', '  ', 7, 'x'.repeat(max + 1)])
      expect(
        contentBriefHumanRevisionSchema.safeParse({
          ...valid,
          changes: { ...valid.changes, [field]: value },
        }).success,
      ).toBe(false);
    expect(
      contentBriefHumanRevisionSchema.safeParse({
        ...valid,
        changes: { ...valid.changes, [field]: 'x'.repeat(max) },
      }).success,
    ).toBe(true);
  });
  it.each([[], [''], [' '], ['x'.repeat(2001)], Array<string>(51).fill('x'), [1], {}, null])(
    'rejects invalid constraints %j',
    (constraints) =>
      expect(
        contentBriefHumanRevisionSchema.safeParse({
          ...valid,
          changes: { ...valid.changes, editorialConstraints: constraints },
        }).success,
      ).toBe(false),
  );
  it('does not mutate the shared Brief schema strictness', () => {
    expect(contentBriefSchema.shape.objective).toBeDefined();
    expect(
      contentBriefHumanRevisionSchema.safeParse({
        ...valid,
        changes: { ...valid.changes, productionLanguage: 'de' },
      }).success,
    ).toBe(false);
  });
});
