import { describe, expect, it } from 'vitest';
import { buildAddRelativeRequest, buildInitialRelationships } from './familyRelationship';

describe('buildInitialRelationships', () => {
  it.each(['Father', 'Mother'] as const)('makes a new %s the parent of the selected relative', (linkType) => {
    expect(buildInitialRelationships(linkType, 'selected')).toEqual([
      { relatedMemberId: 'selected', type: 'parent', direction: 'source' }
    ]);
  });

  it.each(['Son', 'Daughter'] as const)('makes both existing parents sources for a new %s', (linkType) => {
    expect(buildInitialRelationships(linkType, 'selected-parent', 'other-parent')).toEqual([
      { relatedMemberId: 'selected-parent', type: 'parent', direction: 'target' },
      { relatedMemberId: 'other-parent', type: 'parent', direction: 'target' }
    ]);
  });

  it('does not duplicate a parent relationship', () => {
    expect(buildInitialRelationships('Son', 'same-parent', 'same-parent')).toEqual([
      { relatedMemberId: 'same-parent', type: 'parent', direction: 'target' }
    ]);
  });

  it.each([
    ['Brother', 'sibling'],
    ['Sister', 'sibling'],
    ['Spouse', 'spouse']
  ] as const)('translates %s into a %s edge', (linkType, type) => {
    expect(buildInitialRelationships(linkType, 'selected')).toEqual([
      { relatedMemberId: 'selected', type, direction: 'source' }
    ]);
  });
});

describe('buildAddRelativeRequest', () => {
  it('normalizes optional fields and includes an admin-visible reported emirate', () => {
    expect(buildAddRelativeRequest({
      displayName: '  Khaled Mustafa  ',
      birthDate: '1985-04-12',
      phone: '  +971 50 123 4567  ',
      notes: '  Brother of Ahmad  ',
      photoUrl: '',
      relatedMemberId: 'ahmad',
      linkType: 'Brother',
      emirate: '  Dubai  '
    })).toEqual({
      displayName: 'Khaled Mustafa',
      birthDate: '1985-04-12',
      phone: '+971 50 123 4567',
      interests: [],
      notes: 'Brother of Ahmad',
      photoUrl: undefined,
      relationships: [{ relatedMemberId: 'ahmad', type: 'sibling', direction: 'source' }],
      location: { emirate: 'Dubai', precision: 'emirate', visibility: 'family_admin' }
    });
  });
});
