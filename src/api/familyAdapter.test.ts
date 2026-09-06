import { describe, expect, it } from 'vitest';
import { adaptFamilyContext } from './familyAdapter';
import { ApiFamilyMember, FamilyContext, FamilyRelationship, RelationshipType } from '../types';
import { computeTreeLayout, generateConnections } from '../lib/treeLayout';

const member = (id: string, displayName: string): ApiFamilyMember => ({
  id,
  familyId: 'family-1',
  displayName,
  interests: [],
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z'
});

const relationship = (
  id: string,
  sourceMemberId: string,
  targetMemberId: string,
  type: RelationshipType
): FamilyRelationship => ({
  id,
  familyId: 'family-1',
  sourceMemberId,
  targetMemberId,
  type,
  createdAt: '2026-08-13T00:00:00.000Z'
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
    expect(byId.get('me')?.siblingGroupId).toBeUndefined();
    expect(byId.get('sibling-one')?.siblingGroupId).toBe(byId.get('sibling-two')?.siblingGroupId);
  });

  it('completes the parent and spouse links across an explicit full-sibling group', () => {
    const relationships = [
      relationship('dad-ahmad', 'dad', 'ahmad', 'parent'),
      relationship('anas-ahmad', 'anas', 'ahmad', 'sibling'),
      relationship('mom-anas', 'mom', 'anas', 'parent')
    ];
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Mustafa Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'ahmad@example.com', displayName: 'Ahmad', linkedMemberId: 'ahmad' },
      members: [
        member('dad', 'Dad'),
        member('mom', 'Mom'),
        member('ahmad', 'Ahmad Mustafa'),
        member('anas', 'Anas Mustafa')
      ],
      relationships,
      safeLocations: []
    };

    const project = (inputRelationships: FamilyRelationship[]) => {
      const byId = new Map(adaptFamilyContext({ ...context, relationships: inputRelationships }).map(item => [item.id, item]));
      return {
        dad: byId.get('dad'),
        mom: byId.get('mom'),
        ahmad: byId.get('ahmad'),
        anas: byId.get('anas')
      };
    };
    const result = project(relationships);

    expect(result.dad).toMatchObject({ childrenIds: ['ahmad', 'anas'], spouseIds: ['mom'] });
    expect(result.mom).toMatchObject({ childrenIds: ['ahmad', 'anas'], spouseIds: ['dad'] });
    expect(result.ahmad).toMatchObject({ parentIds: ['dad', 'mom'], siblingIds: ['anas'] });
    expect(result.anas).toMatchObject({ parentIds: ['dad', 'mom'], siblingIds: ['ahmad'] });
    expect(result.anas?.relationship).toBe('Sibling');

    // Database row order must not change the completed tree.
    expect(project([...relationships].reverse())).toEqual(result);

    const completedMembers = adaptFamilyContext(context);
    const connectionIds = generateConnections(
      computeTreeLayout(completedMembers, 'ahmad'),
      220,
      180
    ).map(line => line.id);
    expect(connectionIds).toEqual(expect.arrayContaining([
      'spouse-dad-mom',
      'child-dad-mom-ahmad',
      'child-dad-mom-anas'
    ]));
  });

  it('propagates known parents through a transitive explicit sibling component', () => {
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Example Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'a@example.com', displayName: 'A', linkedMemberId: 'a' },
      members: [member('parent', 'Parent'), member('a', 'A'), member('b', 'B'), member('c', 'C')],
      relationships: [
        relationship('parent-a', 'parent', 'a', 'parent'),
        relationship('a-b', 'a', 'b', 'sibling'),
        relationship('b-c', 'b', 'c', 'sibling')
      ],
      safeLocations: []
    };

    const byId = new Map(adaptFamilyContext(context).map(item => [item.id, item]));
    expect(byId.get('parent')?.childrenIds).toEqual(['a', 'b', 'c']);
    expect(byId.get('a')?.parentIds).toEqual(['parent']);
    expect(byId.get('b')?.parentIds).toEqual(['parent']);
    expect(byId.get('c')?.parentIds).toEqual(['parent']);
    expect(byId.get('a')?.siblingIds).toEqual(['b', 'c']);
    expect(byId.get('c')?.siblingIds).toEqual(['a', 'b']);
  });

  it('keeps half-sibling parent sets separate while projecting their shared parent', () => {
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Blended Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'a@example.com', displayName: 'A', linkedMemberId: 'a' },
      members: [
        member('dad', 'Dad'),
        member('mom-a', 'A Mother'),
        member('mom-b', 'B Mother'),
        member('a', 'A'),
        member('b', 'B')
      ],
      relationships: [
        relationship('dad-a', 'dad', 'a', 'parent'),
        relationship('dad-b', 'dad', 'b', 'parent'),
        relationship('mom-a-a', 'mom-a', 'a', 'parent'),
        relationship('mom-b-b', 'mom-b', 'b', 'parent')
      ],
      safeLocations: []
    };

    const byId = new Map(adaptFamilyContext(context).map(item => [item.id, item]));
    expect(byId.get('a')).toMatchObject({ parentIds: ['dad', 'mom-a'], siblingIds: ['b'] });
    expect(byId.get('b')).toMatchObject({ parentIds: ['dad', 'mom-b'], siblingIds: ['a'] });
    expect(byId.get('mom-a')?.childrenIds).toEqual(['a']);
    expect(byId.get('mom-b')?.childrenIds).toEqual(['b']);
    expect(byId.get('dad')?.spouseIds).toEqual(['mom-a', 'mom-b']);
    expect(byId.get('a')?.siblingGroupId).toBeUndefined();
    expect(byId.get('b')?.siblingGroupId).toBeUndefined();
  });

  it('does not turn a spouse, guardian, or generic relative into an inferred parent', () => {
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Example Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'me@example.com', displayName: 'Me', linkedMemberId: 'me' },
      members: [
        member('me', 'Me'),
        member('sibling', 'Sibling'),
        member('spouse', 'Spouse'),
        member('guardian', 'Guardian'),
        member('relative', 'Relative')
      ],
      relationships: [
        relationship('me-sibling', 'me', 'sibling', 'sibling'),
        relationship('me-spouse', 'me', 'spouse', 'spouse'),
        relationship('guardian-me', 'guardian', 'me', 'guardian'),
        relationship('relative-me', 'relative', 'me', 'relative')
      ],
      safeLocations: []
    };

    const adapted = adaptFamilyContext(context);
    const byId = new Map(adapted.map(item => [item.id, item]));
    expect(byId.get('guardian')?.childrenIds).toEqual(['me']);
    expect(byId.get('sibling')?.parentIds).toEqual([]);
    expect(byId.get('spouse')?.childrenIds).toEqual([]);
    expect(byId.get('relative')?.childrenIds).toEqual([]);
    expect(byId.get('me')?.spouseIds).toEqual(['spouse']);
    expect(byId.get('me')?.relativeIds).toEqual(['relative']);
    expect(byId.get('relative')?.relativeIds).toEqual(['me']);

    const connectionIds = generateConnections(computeTreeLayout(adapted, 'me'), 220, 180).map(line => line.id);
    expect(connectionIds).toContain('relative-me-relative');
  });

  it('projects contradictory legacy relationship rows deterministically', () => {
    const relationships = [
      relationship('parent', 'other', 'me', 'parent'),
      relationship('spouse', 'other', 'me', 'spouse'),
      relationship('sibling', 'other', 'me', 'sibling')
    ];
    const context: FamilyContext = {
      family: { id: 'family-1', name: 'Legacy Family', role: 'owner' },
      currentUser: { id: 'user-1', email: 'me@example.com', displayName: 'Me', linkedMemberId: 'me' },
      members: [member('me', 'Me'), member('other', 'Other')],
      relationships,
      safeLocations: []
    };

    expect(adaptFamilyContext({ ...context, relationships: [...relationships].reverse() }))
      .toEqual(adaptFamilyContext(context));
  });
});
