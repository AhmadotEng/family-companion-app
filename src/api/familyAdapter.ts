import { FamilyContext, FamilyMember, FamilyRelationship, Relationship } from '../types';

type RelationshipEdge = Pick<FamilyRelationship, 'sourceMemberId' | 'targetMemberId' | 'type'>;

interface RelationshipProjection {
  relationships: RelationshipEdge[];
  parentEdges: RelationshipEdge[];
  spouseEdges: RelationshipEdge[];
  siblingIds: Map<string, string[]>;
  siblingGroupIds: Map<string, string | undefined>;
}

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

const symmetricPairKey = (left: string, right: string) => (
  left < right ? `${left}:${right}` : `${right}:${left}`
);

const directedPairKey = (source: string, target: string) => `${source}:${target}`;

const buildExplicitSiblingComponents = (memberIds: string[], relationships: RelationshipEdge[]) => {
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

  const membersByRoot = new Map<string, string[]>();
  memberIds.forEach(id => {
    const root = find(id);
    membersByRoot.set(root, [...(membersByRoot.get(root) || []), id]);
  });

  return { membersByRoot, rootByMemberId: new Map(memberIds.map(id => [id, find(id)])) };
};

const parentPathExists = (parentEdges: RelationshipEdge[], startMemberId: string, targetMemberId: string) => {
  const childrenByParent = new Map<string, string[]>();
  parentEdges.forEach(edge => {
    childrenByParent.set(edge.sourceMemberId, [
      ...(childrenByParent.get(edge.sourceMemberId) || []),
      edge.targetMemberId
    ]);
  });

  const visited = new Set<string>();
  const queue = [startMemberId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetMemberId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(childrenByParent.get(current) || []));
  }
  return false;
};

/**
 * Completes the Heritage Tree read model without turning inferred links into
 * persisted facts. An explicit Brother/Sister link is the app's full-sibling
 * assertion, so those members share known parents. Children who merely share
 * one parent are still shown as siblings, but do not inherit each other's
 * other parent (which preserves half-sibling families).
 */
const buildRelationshipProjection = (
  memberIds: string[],
  relationships: FamilyRelationship[]
): RelationshipProjection => {
  const memberIdSet = new Set(memberIds);
  const memberOrder = new Map(memberIds.map((id, index) => [id, index]));
  const compareMemberIds = (left: string, right: string) => (
    (memberOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (memberOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right)
  );
  const relationshipTypeOrder = new Map<RelationshipEdge['type'], number>([
    ['parent', 0],
    ['guardian', 1],
    ['spouse', 2],
    ['sibling', 3],
    ['relative', 4]
  ]);
  const explicitEdges: RelationshipEdge[] = relationships
    .filter(edge => (
      memberIdSet.has(edge.sourceMemberId)
      && memberIdSet.has(edge.targetMemberId)
      && edge.sourceMemberId !== edge.targetMemberId
    ))
    .map(edge => ({
      sourceMemberId: edge.sourceMemberId,
      targetMemberId: edge.targetMemberId,
      type: edge.type
    }))
    .sort((left, right) => (
      (relationshipTypeOrder.get(left.type) ?? Number.MAX_SAFE_INTEGER)
        - (relationshipTypeOrder.get(right.type) ?? Number.MAX_SAFE_INTEGER)
      || compareMemberIds(left.sourceMemberId, right.sourceMemberId)
      || compareMemberIds(left.targetMemberId, right.targetMemberId)
    ));
  const siblingComponents = buildExplicitSiblingComponents(memberIds, explicitEdges);

  const parentEdgesByPair = new Map<string, RelationshipEdge>();
  explicitEdges.filter(edge => edge.type === 'parent').forEach(edge => {
    parentEdgesByPair.set(directedPairKey(edge.sourceMemberId, edge.targetMemberId), edge);
  });
  const explicitParentKeys = new Set(parentEdgesByPair.keys());
  const projectedParentCandidates = new Map<string, RelationshipEdge>();

  siblingComponents.membersByRoot.forEach(componentMemberIds => {
    if (componentMemberIds.length < 2) return;
    const component = new Set(componentMemberIds);
    const componentParents = new Set(
      Array.from(parentEdgesByPair.values())
        .filter(edge => component.has(edge.targetMemberId) && !component.has(edge.sourceMemberId))
        .map(edge => edge.sourceMemberId)
    );

    componentParents.forEach(parentId => {
      componentMemberIds.forEach(childId => {
        const key = directedPairKey(parentId, childId);
        if (parentId === childId || parentEdgesByPair.has(key)) return;
        projectedParentCandidates.set(key, { sourceMemberId: parentId, targetMemberId: childId, type: 'parent' });
      });
    });
  });

  Array.from(projectedParentCandidates.values())
    .sort((left, right) => (
      compareMemberIds(left.sourceMemberId, right.sourceMemberId)
      || compareMemberIds(left.targetMemberId, right.targetMemberId)
    ))
    .forEach(edge => {
      // A malformed cross-generation sibling assertion must never turn the
      // projected read model into a parent cycle.
      if (parentPathExists(Array.from(parentEdgesByPair.values()), edge.targetMemberId, edge.sourceMemberId)) return;
      parentEdgesByPair.set(directedPairKey(edge.sourceMemberId, edge.targetMemberId), edge);
    });

  const spouseEdgesByPair = new Map<string, RelationshipEdge>();
  explicitEdges.filter(edge => edge.type === 'spouse').forEach(edge => {
    spouseEdgesByPair.set(symmetricPairKey(edge.sourceMemberId, edge.targetMemberId), edge);
  });
  const explicitSpouseKeys = new Set(spouseEdgesByPair.keys());

  const parentIdsByChild = new Map<string, Set<string>>();
  parentEdgesByPair.forEach(edge => {
    const parents = parentIdsByChild.get(edge.targetMemberId) || new Set<string>();
    parents.add(edge.sourceMemberId);
    parentIdsByChild.set(edge.targetMemberId, parents);
  });
  parentIdsByChild.forEach(parentIds => {
    const parents = Array.from(parentIds).sort(compareMemberIds);
    // With more than two recorded parents, marriage/co-parent status is
    // ambiguous. Keep every asserted parent link but do not invent a clique.
    if (parents.length !== 2) return;
    const [firstParentId, secondParentId] = parents;
    const firstRoot = siblingComponents.rootByMemberId.get(firstParentId);
    const secondRoot = siblingComponents.rootByMemberId.get(secondParentId);
    const parentsAreExplicitSiblings = firstRoot === secondRoot
      && (siblingComponents.membersByRoot.get(firstRoot || '')?.length || 0) > 1;
    const parentsAreInOneLineage = parentPathExists(Array.from(parentEdgesByPair.values()), firstParentId, secondParentId)
      || parentPathExists(Array.from(parentEdgesByPair.values()), secondParentId, firstParentId);
    if (parentsAreExplicitSiblings || parentsAreInOneLineage) return;

    const key = symmetricPairKey(firstParentId, secondParentId);
    if (!spouseEdgesByPair.has(key)) {
      spouseEdgesByPair.set(key, {
        sourceMemberId: firstParentId,
        targetMemberId: secondParentId,
        type: 'spouse'
      });
    }
  });

  const siblingSets = new Map(memberIds.map(id => [id, new Set<string>()]));
  const addSiblingPair = (left: string, right: string) => {
    if (left === right || !memberIdSet.has(left) || !memberIdSet.has(right)) return;
    siblingSets.get(left)!.add(right);
    siblingSets.get(right)!.add(left);
  };

  // Explicit sibling components are full-sibling groups and therefore
  // transitive in this simplified family model.
  siblingComponents.membersByRoot.forEach(componentMemberIds => {
    componentMemberIds.forEach((memberId, index) => {
      componentMemberIds.slice(index + 1).forEach(siblingId => addSiblingPair(memberId, siblingId));
    });
  });

  // Sharing one effective parent is enough to be a sibling, including a half
  // sibling, but these pairs are deliberately not unioned transitively.
  const childrenByParent = new Map<string, string[]>();
  parentEdgesByPair.forEach(edge => {
    childrenByParent.set(edge.sourceMemberId, [
      ...(childrenByParent.get(edge.sourceMemberId) || []),
      edge.targetMemberId
    ]);
  });
  childrenByParent.forEach(children => {
    const uniqueChildren = [...new Set(children)].sort(compareMemberIds);
    uniqueChildren.forEach((childId, index) => {
      uniqueChildren.slice(index + 1).forEach(siblingId => addSiblingPair(childId, siblingId));
    });
  });

  const siblingGroupIds = new Map<string, string | undefined>();
  memberIds.forEach(memberId => {
    const component = siblingComponents.membersByRoot.get(siblingComponents.rootByMemberId.get(memberId) || '') || [memberId];
    const sortedComponent = [...component].sort(compareMemberIds);
    siblingGroupIds.set(
      memberId,
      sortedComponent.length > 1 ? `siblings-${sortedComponent.join('-')}` : undefined
    );
  });
  const siblingIds = new Map<string, string[]>();
  siblingSets.forEach((siblings, memberId) => siblingIds.set(memberId, Array.from(siblings).sort(compareMemberIds)));

  const projectedRelationships = [...explicitEdges];
  parentEdgesByPair.forEach((edge, key) => {
    if (!explicitParentKeys.has(key)) projectedRelationships.push(edge);
  });
  spouseEdgesByPair.forEach((edge, key) => {
    if (!explicitSpouseKeys.has(key)) projectedRelationships.push(edge);
  });
  const compareEdges = (left: RelationshipEdge, right: RelationshipEdge) => (
    compareMemberIds(left.sourceMemberId, right.sourceMemberId)
    || compareMemberIds(left.targetMemberId, right.targetMemberId)
    || left.type.localeCompare(right.type)
  );

  return {
    relationships: projectedRelationships,
    parentEdges: Array.from(parentEdgesByPair.values()).sort(compareEdges),
    spouseEdges: Array.from(spouseEdgesByPair.values()).sort(compareEdges),
    siblingIds,
    siblingGroupIds
  };
};

const deriveGenerations = (memberIds: string[], relationships: RelationshipEdge[], rootMemberId?: string) => {
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
  relationships: RelationshipEdge[],
  siblingIds: Map<string, string[]>
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
  if (siblingIds.get(rootMemberId)?.includes(id)) return 'Sibling';
  if (generation < 1) return 'Grandparent';
  if (generation === 1) return 'Parent';
  if (generation === 3) return 'Child';
  if (generation > 3) return 'Grandchild';
  return 'Relative';
}

export function adaptFamilyContext(context: FamilyContext): FamilyMember[] {
  const ids = context.members.map(member => member.id);
  const relationshipProjection = buildRelationshipProjection(ids, context.relationships);
  const generations = deriveGenerations(ids, relationshipProjection.relationships, context.currentUser.linkedMemberId);
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
        relationshipProjection.relationships,
        relationshipProjection.siblingIds
      ),
      phone: member.phone || '',
      email: member.email || '',
      interests: member.interests || [],
      locationSharingStatus: safeLocation ? 'Active' : 'Inactive',
      notes: member.notes,
      parentIds: [],
      spouseIds: [],
      childrenIds: [],
      siblingIds: relationshipProjection.siblingIds.get(member.id) || [],
      siblingGroupId: relationshipProjection.siblingGroupIds.get(member.id),
      relativeIds: [],
      familyBranch: generation <= 1 ? 'Elders' : 'Main',
      memories: [],
      generation,
      apiMember: member,
      safeLocation
    });
  });

  [
    ...relationshipProjection.parentEdges,
    ...context.relationships.filter(edge => edge.type === 'guardian')
  ].forEach(edge => {
    const source = members.get(edge.sourceMemberId);
    const target = members.get(edge.targetMemberId);
    if (!source || !target) return;

    addUnique(source.childrenIds!, target.id);
    addUnique(target.parentIds!, source.id);
  });

  relationshipProjection.spouseEdges.forEach(edge => {
    const source = members.get(edge.sourceMemberId);
    const target = members.get(edge.targetMemberId);
    if (!source || !target) return;

    addUnique(source.spouseIds!, target.id);
    addUnique(target.spouseIds!, source.id);
    source.spouseId ||= target.id;
    target.spouseId ||= source.id;
  });

  context.relationships.filter(edge => edge.type === 'relative').forEach(edge => {
    const source = members.get(edge.sourceMemberId);
    const target = members.get(edge.targetMemberId);
    if (!source || !target) return;

    addUnique(source.relativeIds!, target.id);
    addUnique(target.relativeIds!, source.id);
  });

  return Array.from(members.values());
}
