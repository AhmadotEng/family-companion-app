import { describe, expect, it } from 'vitest';
import { adaptFamilyContext } from './familyAdapter';
import { ApiFamilyMember, FamilyContext } from '../types';

const member = (id: string, displayName: string): ApiFamilyMember => ({
  id,
  familyId: 'family-1',
  displayName,
  interests: [],
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z'
});

describe('adaptFamilyContext', () => {
  it('projects normalized relationships into the custom tree without changing the API DTOs', () => {
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Example Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'me@example.com', displayName: 'Me', linkedMemberId: 'me' },
      members: [
        member('grandparent', 'Grandparent'),
        member('parent', 'Parent'),
        member('me', 'Me'),
        member('spouse', 'Spouse'),
        member('child', 'Child')
      ],
      relationships: [
        { id: 'r1', familyId: 'family-1', sourceMemberId: 'grandparent', targetMemberId: 'parent', type: 'parent', createdAt: '2026-08-13T00:00:00.000Z' },
        { id: 'r2', familyId: 'family-1', sourceMemberId: 'parent', targetMemberId: 'me', type: 'parent', createdAt: '2026-08-13T00:00:00.000Z' },
        { id: 'r3', familyId: 'family-1', sourceMemberId: 'me', targetMemberId: 'spouse', type: 'spouse', createdAt: '2026-08-13T00:00:00.000Z' },
        { id: 'r4', familyId: 'family-1', sourceMemberId: 'me', targetMemberId: 'child', type: 'parent', createdAt: '2026-08-13T00:00:00.000Z' },
        { id: 'r5', familyId: 'family-1', sourceMemberId: 'spouse', targetMemberId: 'child', type: 'parent', createdAt: '2026-08-13T00:00:00.000Z' }
      ],
      safeLocations: [{
        memberId: 'parent',
        source: 'manual',
        precision: 'emirate',
        visibility: 'family',
        emirate: 'Sharjah',
        capturedAt: '2026-08-13T00:00:00.000Z'
      }]
    };

    const result = adaptFamilyContext(context);
    const byId = new Map(result.map(item => [item.id, item]));

    expect(byId.get('me')).toMatchObject({
      relationship: 'Me',
      generation: 2,
      parentIds: ['parent'],
      spouseIds: ['spouse'],
      childrenIds: ['child']
    });
    expect(byId.get('grandparent')).toMatchObject({ relationship: 'Grandparent', generation: 0, childrenIds: ['parent'] });
    expect(byId.get('parent')).toMatchObject({ relationship: 'Parent', generation: 1, parentIds: ['grandparent'], childrenIds: ['me'] });
    expect(byId.get('spouse')).toMatchObject({ relationship: 'Spouse', generation: 2, spouseIds: ['me'], childrenIds: ['child'] });
    expect(byId.get('child')).toMatchObject({ relationship: 'Child', generation: 3, parentIds: ['me', 'spouse'] });
    expect(byId.get('parent')?.safeLocation).toEqual(context.safeLocations[0]);
    expect(context.members[0]).not.toHaveProperty('parentIds');
  });

  it('groups explicit sibling edges and never introduces location coordinates', () => {
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Example Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'me@example.com', displayName: 'Me', linkedMemberId: 'me' },
      members: [member('me', 'Me'), member('sibling', 'Sibling')],
      relationships: [
        { id: 'r1', familyId: 'family-1', sourceMemberId: 'me', targetMemberId: 'sibling', type: 'sibling', createdAt: '2026-08-13T00:00:00.000Z' }
      ],
      safeLocations: [{
        memberId: 'sibling',
        source: 'browser',
        precision: 'approximate',
        visibility: 'family',
        distanceBand: '5-to-25-km',
        capturedAt: '2026-08-13T00:00:00.000Z'
      }]
    };

    const result = adaptFamilyContext(context);
    expect(result[0].siblingGroupId).toBe(result[1].siblingGroupId);
    expect(result[1].relationship).toBe('Sibling');
    expect(result[0].siblingIds).toEqual(['sibling']);
    expect(result[1].siblingIds).toEqual(['me']);
    expect(result[1].safeLocation).toEqual(expect.objectContaining({ distanceBand: '5-to-25-km' }));
    expect(JSON.stringify(result)).not.toContain('latitude');
    expect(JSON.stringify(result)).not.toContain('longitude');
  });

  it('projects transitive and shared-parent siblings for labels and profile details', () => {
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Example Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'me@example.com', displayName: 'Me', linkedMemberId: 'me' },
      members: [
        member('parent', 'Parent'),
        member('me', 'Me'),
        member('sibling-one', 'Sibling One'),
        member('sibling-two', 'Sibling Two')
      ],
      relationships: [
        { id: 'r1', familyId: 'family-1', sourceMemberId: 'parent', targetMemberId: 'me', type: 'parent', createdAt: '2026-08-13T00:00:00.000Z' },
        { id: 'r2', familyId: 'family-1', sourceMemberId: 'parent', targetMemberId: 'sibling-one', type: 'parent', createdAt: '2026-08-13T00:00:00.000Z' },
        { id: 'r3', familyId: 'family-1', sourceMemberId: 'sibling-one', targetMemberId: 'sibling-two', type: 'sibling', createdAt: '2026-08-13T00:00:00.000Z' }
      ],
      safeLocations: []
    };

    const result = adaptFamilyContext(context);
    const byId = new Map(result.map(item => [item.id, item]));

    expect(byId.get('me')?.siblingIds).toEqual(['sibling-one', 'sibling-two']);
    expect(byId.get('sibling-one')?.siblingIds).toEqual(['me', 'sibling-two']);
    expect(byId.get('sibling-two')?.siblingIds).toEqual(['me', 'sibling-one']);
    expect(byId.get('sibling-one')?.relationship).toBe('Sibling');
    expect(byId.get('sibling-two')?.relationship).toBe('Sibling');
    expect(byId.get('me')?.siblingGroupId).toBe(byId.get('sibling-two')?.siblingGroupId);
  });
});
