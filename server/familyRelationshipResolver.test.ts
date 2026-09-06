import { describe, expect, it } from 'vitest';
import {
  buildEffectiveFamilyRelationships,
  resolveGatheringInvitees,
  type EffectiveMemberRelationships,
  type RelationshipResolverEdge,
  type RelationshipResolverMember,
} from './familyRelationshipResolver';

const member = (id: string, displayName = id): RelationshipResolverMember => ({ id, displayName });
const edge = (
  sourceMemberId: string,
  targetMemberId: string,
  type: RelationshipResolverEdge['type'],
): RelationshipResolverEdge => ({ sourceMemberId, targetMemberId, type });

function effectiveFor(
  members: RelationshipResolverMember[],
  edges: RelationshipResolverEdge[],
): EffectiveMemberRelationships[] {
  return buildEffectiveFamilyRelationships(members, edges);
}

function resolve({
  request,
  members,
  edges = [],
  requesterMemberId = 'ahmad',
  providerMemberIds = [],
  history = [],
}: {
  request: string;
  members: RelationshipResolverMember[];
  edges?: RelationshipResolverEdge[];
  requesterMemberId?: string | null;
  providerMemberIds?: string[];
  history?: Array<{ role: 'user' | 'assistant'; message: string }>;
}) {
  return resolveGatheringInvitees({
    request,
    history,
    members,
    effectiveRelationships: effectiveFor(members, edges),
    requesterMemberId,
    providerMemberIds,
  });
}

describe('effective Heritage relationship projection matrix', () => {
  it('projects full-sibling parents, preserves half-sibling boundaries, and excludes non-biological edges', () => {
    const members = [
      member('ahmad'), member('anas'), member('half'), member('dad'), member('mom'),
      member('spouse'), member('child'), member('guardian'), member('relative'),
    ];
    const result = effectiveFor(members, [
      edge('ahmad', 'anas', 'sibling'),
      edge('dad', 'ahmad', 'parent'),
      edge('mom', 'anas', 'parent'),
      edge('dad', 'half', 'parent'),
      edge('ahmad', 'spouse', 'spouse'),
      edge('ahmad', 'child', 'parent'),
      edge('guardian', 'ahmad', 'guardian'),
      edge('relative', 'ahmad', 'relative'),
    ]);
    const byId = new Map(result.map(item => [item.memberId, item]));

    expect(byId.get('ahmad')).toMatchObject({
      parentMemberIds: ['dad', 'mom'],
      spouseMemberIds: ['spouse'],
      siblingMemberIds: ['anas', 'half'],
      childMemberIds: ['child'],
    });
    expect(byId.get('anas')?.parentMemberIds).toEqual(['dad', 'mom']);
    expect(byId.get('half')?.parentMemberIds).toEqual(['dad']);
    expect(byId.get('half')?.parentMemberIds).not.toContain('mom');
    expect(byId.get('ahmad')?.parentMemberIds).not.toContain('guardian');
    expect(byId.get('ahmad')?.parentMemberIds).not.toContain('relative');
    expect(byId.get('spouse')?.childMemberIds).toEqual([]);
    expect(byId.get('dad')?.spouseMemberIds).toEqual(['mom']);
    expect(byId.get('mom')?.spouseMemberIds).toEqual(['dad']);
  });

  it('does not infer spouse pairs when a child has three effective parents', () => {
    const members = [member('child'), member('p1'), member('p2'), member('p3')];
    const result = effectiveFor(members, [
      edge('p1', 'child', 'parent'),
      edge('p2', 'child', 'parent'),
      edge('p3', 'child', 'parent'),
    ]);
    const byId = new Map(result.map(item => [item.memberId, item]));
    expect(byId.get('child')?.parentMemberIds).toEqual(['p1', 'p2', 'p3']);
    expect(byId.get('p1')?.spouseMemberIds).toEqual([]);
    expect(byId.get('p2')?.spouseMemberIds).toEqual([]);
    expect(byId.get('p3')?.spouseMemberIds).toEqual([]);
  });

  it('ignores dangling, self-referential, and duplicate edges deterministically', () => {
    const members = [member('a'), member('b')];
    const result = effectiveFor(members, [
      edge('a', 'a', 'sibling'),
      edge('missing', 'a', 'parent'),
      edge('a', 'missing', 'parent'),
      edge('a', 'b', 'spouse'),
      edge('b', 'a', 'spouse'),
    ]);
    const byId = new Map(result.map(item => [item.memberId, item]));
    expect(byId.get('a')?.siblingMemberIds).toEqual([]);
    expect(byId.get('a')?.parentMemberIds).toEqual([]);
    expect(byId.get('a')?.spouseMemberIds).toEqual(['b']);
    expect(byId.get('b')?.spouseMemberIds).toEqual(['a']);
  });
});

describe('deterministic gathering invitee phrase matrix', () => {
  const requester = member('ahmad', 'Ahmad Mustafa');

  it.each(['parent', 'mother', 'mom', 'mama', 'father', 'dad', 'dada'])('resolves singular parent wording: my %s', phrase => {
    const parent = member('parent', 'Only Parent');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, parent],
      edges: [edge('parent', 'ahmad', 'parent')],
    });
    expect(result).toMatchObject({ memberIds: ['parent'], inviteesRequested: true });
    expect(result.clarification).toBeUndefined();
  });

  it.each(['parents', 'mothers', 'moms', 'mamas', 'fathers', 'dads', 'dadas'])('resolves plural parent wording: my %s', phrase => {
    const first = member('p1', 'Parent One');
    const second = member('p2', 'Parent Two');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, first, second],
      edges: [edge('p1', 'ahmad', 'parent'), edge('p2', 'ahmad', 'parent')],
    });
    expect(result.memberIds).toEqual(['p1', 'p2']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['sibling', 'brother', 'sister'])('resolves singular sibling wording: my %s', phrase => {
    const sibling = member('sibling', 'Only Sibling');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, sibling],
      edges: [edge('ahmad', 'sibling', 'sibling')],
    });
    expect(result.memberIds).toEqual(['sibling']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['siblings', 'brothers', 'sisters'])('resolves plural sibling wording: my %s', phrase => {
    const first = member('s1', 'Sibling One');
    const second = member('s2', 'Sibling Two');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, first, second],
      edges: [edge('ahmad', 's1', 'sibling'), edge('ahmad', 's2', 'sibling')],
    });
    expect(result.memberIds).toEqual(['s1', 's2']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['spouse', 'wife', 'husband'])('resolves spouse wording: my %s', phrase => {
    const spouse = member('spouse', 'Only Spouse');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, spouse],
      edges: [edge('ahmad', 'spouse', 'spouse')],
    });
    expect(result.memberIds).toEqual(['spouse']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['spouses', 'wives', 'husbands'])('resolves plural spouse wording: my %s', phrase => {
    const first = member('spouse-1', 'Spouse One');
    const second = member('spouse-2', 'Spouse Two');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, first, second],
      edges: [edge('ahmad', 'spouse-1', 'spouse'), edge('ahmad', 'spouse-2', 'spouse')],
    });
    expect(result.memberIds).toEqual(['spouse-1', 'spouse-2']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['child', 'kid', 'son', 'daughter'])('resolves singular child wording: my %s', phrase => {
    const child = member('child', 'Only Child');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, child],
      edges: [edge('ahmad', 'child', 'parent')],
    });
    expect(result.memberIds).toEqual(['child']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['children', 'kids', 'sons', 'daughters'])('resolves plural child wording: my %s', phrase => {
    const first = member('c1', 'Child One');
    const second = member('c2', 'Child Two');
    const result = resolve({
      request: `Plan dinner with my ${phrase} on September 12, 2099 at 5 PM.`,
      members: [requester, first, second],
      edges: [edge('ahmad', 'c1', 'parent'), edge('ahmad', 'c2', 'parent')],
    });
    expect(result.memberIds).toEqual(['c1', 'c2']);
    expect(result.clarification).toBeUndefined();
  });

  it.each([
    'with Dad',
    'invite Dad',
    'including Dad',
    'dinner for Dad',
    'take Dad to Golden Park',
    'bring Dad',
    'meet Dad at Home',
  ])('resolves the explicit-name syntax %s', syntax => {
    const dad = member('dad', 'Dad');
    const result = resolve({
      request: `Plan ${syntax} on September 12, 2099 at 5 PM.`,
      members: [requester, dad],
    });
    expect(result.memberIds).toEqual(['dad']);
    expect(result.clarification).toBeUndefined();
  });

  it.each([
    'with a budget of AED 100',
    'with transportation arranged',
    'with transport by car',
    'with a picnic blanket',
    'with sunscreen',
    'with a rain backup plan',
    'with a taxi',
    'with folding chairs',
    'with an indoor rain backup',
  ])('does not reinterpret the non-person planning adjunct %s as an invitee', adjunct => {
    const result = resolve({
      request: `Plan a family outing at Golden Park ${adjunct} on September 12, 2099 at 5 PM.`,
      members: [requester, member('dad', 'Dad')],
    });
    expect(result.memberIds).toEqual([]);
    expect(result.inviteesRequested).toBeFalsy();
    expect(result.clarification).toBeUndefined();
  });

  it.each([
    'with Dad on a budget of AED 100',
    'with Dad and transportation arranged',
    'with transportation arranged and Dad',
    'with Dad and a picnic blanket',
    'with a picnic blanket and Dad',
    'with Dad and sunscreen',
    'with sunscreen and Dad',
    'with Dad and a rain backup plan',
    'with a rain backup plan and Dad',
    'with Dad and a taxi',
    'with a taxi and Dad',
    'with Dad and folding chairs',
    'with folding chairs and Dad',
  ])('preserves a real invitee around a planning adjunct: %s', wording => {
    const dad = member('dad', 'Dad');
    const result = resolve({
      request: `Plan a family outing at Golden Park ${wording} on September 12, 2099 at 5 PM.`,
      members: [requester, dad],
      edges: [edge('dad', 'ahmad', 'parent')],
    });
    expect(result.memberIds).toEqual(['dad']);
    expect(result.inviteesRequested).toBe(true);
    expect(result.clarification).toBeUndefined();
  });

  it('retains an earlier invitee when a schedule follow-up contains only a planning adjunct', () => {
    const dad = member('dad', 'Dad');
    const result = resolve({
      request: 'September 12, 2099 at 5 PM with a budget of AED 100.',
      history: [
        { role: 'user', message: 'Plan a family outing at Golden Park with Dad.' },
        { role: 'assistant', message: 'What date and Dubai time would you like for this gathering?' },
      ],
      members: [requester, dad],
    });
    expect(result.memberIds).toEqual(['dad']);
    expect(result.clarification).toBeUndefined();
  });

  it('applies a newest named invitee correction while ignoring its planning adjunct', () => {
    const dad = member('dad', 'Dad');
    const mom = member('mom', 'Mom');
    const result = resolve({
      request: 'Actually Mom instead, with a budget of AED 100. September 12, 2099 at 5 PM.',
      history: [
        { role: 'user', message: 'Plan a family outing at Golden Park with Dad.' },
        { role: 'assistant', message: 'What date and Dubai time would you like for this gathering?' },
      ],
      members: [requester, dad, mom],
    });
    expect(result.memberIds).toEqual(['mom']);
    expect(result.clarification).toBeUndefined();
  });

  it('still clarifies a genuinely unknown person next to a planning adjunct', () => {
    const result = resolve({
      request: 'Plan a family outing at Golden Park with Noura and a picnic blanket on September 12, 2099 at 5 PM.',
      members: [requester, member('dad', 'Dad')],
    });
    expect(result.memberIds).toEqual([]);
    expect(result.clarification).toMatch(/couldn't match/i);
  });

  it('clarifies ambiguous and unknown names without using provider-selected IDs', () => {
    const firstAlex = member('alex-1', 'Alex');
    const secondAlex = member('alex-2', 'Alex');
    const dad = member('dad', 'Dad');
    const ambiguous = resolve({
      request: 'Plan dinner with Alex on September 12, 2099 at 5 PM.',
      members: [requester, firstAlex, secondAlex, dad],
      providerMemberIds: ['dad'],
    });
    expect(ambiguous.memberIds).toEqual([]);
    expect(ambiguous.clarification).toMatch(/multiple matching family profiles/i);

    const unknown = resolve({
      request: 'Plan dinner with Mariam on September 12, 2099 at 5 PM.',
      members: [requester, dad],
      providerMemberIds: ['dad'],
    });
    expect(unknown.memberIds).toEqual([]);
    expect(unknown.clarification).toMatch(/couldn't match/i);
  });

  it.each(['family', 'everyone', 'everybody', 'friends', 'guests']) (
    'clarifies broad invitee wording instead of inventing a selection: %s',
    phrase => {
      const dad = member('dad', 'Dad');
      const result = resolve({
        request: `Plan dinner with ${phrase} on September 12, 2099 at 5 PM.`,
        members: [requester, dad],
        providerMemberIds: ['dad'],
      });
      expect(result.memberIds).toEqual([]);
      expect(result.inviteesRequested).toBeUndefined();
      expect(result.clarification).toMatch(/which (?:visible )?family members?/i);
    },
  );

  it('requires a linked requester before resolving relationship wording', () => {
    const dad = member('dad', 'Dad');
    const result = resolve({
      request: 'Plan dinner with my dad on September 12, 2099 at 5 PM.',
      members: [requester, dad],
      edges: [edge('dad', 'ahmad', 'parent')],
      requesterMemberId: null,
    });
    expect(result.memberIds).toEqual([]);
    expect(result.clarification).toMatch(/link your account/i);
  });

  it('clarifies singular relationship wording when more than one match exists', () => {
    const first = member('s1', 'Sibling One');
    const second = member('s2', 'Sibling Two');
    const result = resolve({
      request: 'Plan dinner with my sibling on September 12, 2099 at 5 PM.',
      members: [requester, first, second],
      edges: [edge('ahmad', 's1', 'sibling'), edge('ahmad', 's2', 'sibling')],
    });
    expect(result.memberIds).toEqual([]);
    expect(result.clarification).toMatch(/which sibling do you mean/i);
  });

  it('requires at least two visible parents for plural parent wording', () => {
    const dad = member('dad', 'Dad');
    const result = resolve({
      request: 'Plan dinner with my parents on September 12, 2099 at 5 PM.',
      members: [requester, dad],
      edges: [edge('dad', 'ahmad', 'parent')],
    });
    expect(result.memberIds).toEqual([]);
    expect(result.clarification).toMatch(/only find one visible parent/i);
  });

  it('honors explicit exclusions, no-invitee wording, and explicit self-inclusion', () => {
    const dad = member('dad', 'Dad');
    const mom = member('mom', 'Mom');
    const excluded = resolve({
      request: 'Plan dinner with Dad but not Mom on September 12, 2099 at 5 PM.',
      members: [requester, dad, mom],
    });
    expect(excluded.memberIds).toEqual(['dad']);

    const nobody = resolve({
      request: 'Plan dinner alone on September 12, 2099 at 5 PM.',
      members: [requester, dad],
      providerMemberIds: ['dad'],
    });
    expect(nobody).toMatchObject({ memberIds: [], requesterExplicitlyIncluded: false });

    const self = resolve({
      request: 'Plan dinner with Dad and me on September 12, 2099 at 5 PM.',
      members: [requester, dad],
    });
    expect(self.memberIds).toEqual(['dad', 'ahmad']);
    expect(self.requesterExplicitlyIncluded).toBe(true);
  });

  it.each([
    'with Dad, nobody else',
    'with Dad and nobody else',
    'with Dad but no one else',
    'invite Dad - nobody else',
  ])('keeps the explicitly named invitee in the bounded exclusion phrase “%s”', wording => {
    const dad = member('dad', 'Dad');
    const result = resolve({
      request: `Plan dinner ${wording} on September 12, 2099 at 5 PM.`,
      members: [requester, dad],
    });
    expect(result.memberIds).toEqual(['dad']);
    expect(result.clarification).toBeUndefined();
  });

  it.each(['with nobody else', 'with no one', 'alone', 'solo', 'by myself', 'just me'])(
    'keeps the true no-invitee phrase “%s” empty',
    wording => {
      const dad = member('dad', 'Dad');
      const result = resolve({
        request: `Plan dinner ${wording} on September 12, 2099 at 5 PM.`,
        members: [requester, dad],
        providerMemberIds: ['dad'],
      });
      expect(result.memberIds).toEqual([]);
      expect(result.requesterExplicitlyIncluded).toBe(false);
      expect(result.clarification).toBeUndefined();
    },
  );

  it.each([
    'wheelchair access',
    'accessible seating',
    'halal food',
    'kosher food',
    'vegan food',
    'vegetarian food',
    'pescatarian food',
    'gluten-free food',
    'dairy free food',
    'lactose-free food',
    'nut-free food',
    'peanut free food',
    'sugar-free food',
    'no peanuts',
  ])('does not mistake the explicit detail “%s” for an invitee', detail => {
    const result = resolve({
      request: `Plan dinner at Home with ${detail} on September 12, 2099 at 5 PM.`,
      members: [requester],
    });
    expect(result.memberIds).toEqual([]);
    expect(result.inviteesRequested).toBe(false);
    expect(result.clarification).toBeUndefined();
  });

  it('flags out-of-context provider IDs and otherwise ignores provider-originated selections', () => {
    const dad = member('dad', 'Dad');
    const invalid = resolve({
      request: 'Plan dinner on September 12, 2099 at 5 PM.',
      members: [requester, dad],
      providerMemberIds: ['outside-family'],
    });
    expect(invalid.invalidMemberIds).toEqual(['outside-family']);

    const unsupported = resolve({
      request: 'Plan dinner on September 12, 2099 at 5 PM.',
      members: [requester, dad],
      providerMemberIds: ['dad'],
    });
    expect(unsupported.memberIds).toEqual([]);
  });
});
