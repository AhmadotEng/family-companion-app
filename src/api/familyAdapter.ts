import { FamilyContext, FamilyMember, FamilyRelationship, Relationship } from '../types';

const addUnique = (items: string[], item: string) => {
  if (!items.includes(item)) items.push(item);
};

const ageFromBirthDate = (birthDate?: string) => {
  if (!birthDate) return 0;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return Math.max(age, 0);
};

const buildSiblingProjection = (memberIds: string[], relationships: FamilyRelationship[]) => {
  const memberIdSet = new Set(memberIds);
  const parent = new Map(memberIds.map(id => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return current;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    if (!memberIdSet.has(left) || !memberIdSet.has(right)) return;
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  relationships.filter(edge => edge.type === 'sibling').forEach(edge => union(edge.sourceMemberId, edge.targetMemberId));

  // Parent edges also imply siblinghood, including half-siblings. This keeps
  // the presentation correct even when the API stores only parent-child edges.
  const childrenByParent = new Map<string, string[]>();
  relationships.filter(edge => edge.type === 'parent').forEach(edge => {
    if (!memberIdSet.has(edge.sourceMemberId) || !memberIdSet.has(edge.targetMemberId)) return;
    childrenByParent.set(edge.sourceMemberId, [
      ...(childrenByParent.get(edge.sourceMemberId) || []),
      edge.targetMemberId
    ]);
  });
  childrenByParent.forEach(children => {
    children.slice(1).forEach(childId => union(children[0], childId));
  });

  const membersByRoot = new Map<string, string[]>();
  memberIds.forEach(id => {
    const root = find(id);
    membersByRoot.set(root, [...(membersByRoot.get(root) || []), id]);
  });

  const groupIds = new Map<string, string | undefined>();
  const siblingIds = new Map<string, string[]>();
  memberIds.forEach(id => {
    const groupMembers = membersByRoot.get(find(id)) || [id];
    groupIds.set(id, groupMembers.length > 1 ? `siblings-${find(id)}` : undefined);
    siblingIds.set(id, groupMembers.filter(memberId => memberId !== id));
  });

  return { groupIds, siblingIds };
};

const deriveGenerations = (memberIds: string[], relationships: FamilyRelationship[], rootMemberId?: string) => {
  const generations = new Map<string, number>();
  if (rootMemberId) generations.set(rootMemberId, 2);

  // Relationships are constraints: a parent is one row above a child; spouses
  // and siblings share a row. Iteration handles grandparents without storing a
  // fragile denormalized generation in the database.
  for (let pass = 0; pass < memberIds.length * 2; pass += 1) {
    let changed = false;
    relationships.forEach(edge => {
      const source = generations.get(edge.sourceMemberId);
      const target = generations.get(edge.targetMemberId);
      const sameLevel = edge.type === 'spouse' || edge.type === 'sibling' || edge.type === 'relative';
      const delta = edge.type === 'parent' || edge.type === 'guardian' ? 1 : 0;

      if (source !== undefined && target === undefined) {
        generations.set(edge.targetMemberId, source + (sameLevel ? 0 : delta));
        changed = true;
      } else if (target !== undefined && source === undefined) {
        generations.set(edge.sourceMemberId, target - (sameLevel ? 0 : delta));
        changed = true;
      }
    });
    if (!changed) break;
  }

  memberIds.forEach(id => {
    if (!generations.has(id)) generations.set(id, 2);
  });
  return generations;
};

function relationshipLabel(
  id: string,
  rootMemberId: string | undefined,
  generation: number,
  relationships: FamilyRelationship[],
  siblingGroups: Map<string, string | undefined>
): Relationship {
  if (id === rootMemberId) return 'Me';
  if (!rootMemberId) return 'Relative';

  const direct = relationships.find(edge => (
    (edge.sourceMemberId === id && edge.targetMemberId === rootMemberId)
    || (edge.targetMemberId === id && edge.sourceMemberId === rootMemberId)
  ));

  if (direct?.type === 'spouse') return 'Spouse';
  if (direct?.type === 'sibling') return 'Sibling';
  if (direct?.type === 'parent') return direct.sourceMemberId === id ? 'Parent' : 'Child';
  const siblingGroup = siblingGroups.get(id);
  if (siblingGroup && siblingGroup === siblingGroups.get(rootMemberId)) return 'Sibling';
  if (generation < 1) return 'Grandparent';
  if (generation === 1) return 'Parent';
  if (generation === 3) return 'Child';
  if (generation > 3) return 'Grandchild';
  return 'Relative';
}

export function adaptFamilyContext(context: FamilyContext): FamilyMember[] {
  const ids = context.members.map(member => member.id);
  const siblingProjection = buildSiblingProjection(ids, context.relationships);
  const generations = deriveGenerations(ids, context.relationships, context.currentUser.linkedMemberId);
  const safeLocations = new Map(context.safeLocations.map(location => [location.memberId, location]));
  const members = new Map<string, FamilyMember>();

  context.members.forEach(member => {
    const generation = generations.get(member.id) ?? 2;
    const safeLocation = safeLocations.get(member.id);
    members.set(member.id, {
      id: member.id,
      name: member.displayName,
      photo: member.photoUrl,
      age: ageFromBirthDate(member.birthDate),
      birthday: member.birthDate || '',
      relationship: relationshipLabel(
        member.id,
        context.currentUser.linkedMemberId,
        generation,
        context.relationships,
        siblingProjection.groupIds
      ),
      phone: member.phone || '',
      email: member.email || '',
      interests: member.interests || [],
      locationSharingStatus: safeLocation ? 'Active' : 'Inactive',
      notes: member.notes,
      parentIds: [],
      spouseIds: [],
      childrenIds: [],
      siblingIds: siblingProjection.siblingIds.get(member.id) || [],
      siblingGroupId: siblingProjection.groupIds.get(member.id),
      familyBranch: generation <= 1 ? 'Elders' : 'Main',
      memories: [],
      generation,
      apiMember: member,
      safeLocation
    });
  });

  context.relationships.forEach(edge => {
    const source = members.get(edge.sourceMemberId);
    const target = members.get(edge.targetMemberId);
    if (!source || !target) return;

    if (edge.type === 'parent' || edge.type === 'guardian') {
      addUnique(source.childrenIds!, target.id);
      addUnique(target.parentIds!, source.id);
    } else if (edge.type === 'spouse') {
      addUnique(source.spouseIds!, target.id);
      addUnique(target.spouseIds!, source.id);
      source.spouseId ||= target.id;
      target.spouseId ||= source.id;
    } else if (edge.type === 'sibling') {
      addUnique(source.siblingIds!, target.id);
      addUnique(target.siblingIds!, source.id);
    }
  });

  return Array.from(members.values());
}
