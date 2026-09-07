import { FamilyMember } from '../types';

export interface LayoutNode {
  member: FamilyMember;
  x: number;
  y: number;
}

export interface ConnectionLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: 'parent-child' | 'spouse' | 'sibling-hub' | 'relative';
  curve?: number;
  heartX?: number;
  heartY?: number;
  fromHeart?: boolean;
  routeOffset?: number;
}

export interface TreeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface TreeTransform {
  scale: number;
  x: number;
  y: number;
}

export interface FocusedRelationshipGroups {
  parents: FamilyMember[];
  partners: FamilyMember[];
  siblings: FamilyMember[];
  children: FamilyMember[];
  others: FamilyMember[];
}

const uniqueIds = (ids: (string | undefined)[]) => (
  ids.filter((id, index): id is string => Boolean(id) && ids.indexOf(id) === index)
);

const getSpouseIds = (member: FamilyMember) => uniqueIds([
  member.spouseId,
  ...(member.spouseIds || [])
]);

const compareMembers = (a: FamilyMember, b: FamilyMember) => (
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
);

/**
 * Groups the effective Heritage projection relative to a focused member.
 * Every relationship check is symmetric so the presentation remains useful
 * while older families are being upgraded to the completed server projection.
 */
export function groupMembersByFocus(members: FamilyMember[], focusId: string): FocusedRelationshipGroups {
  const focus = members.find(member => member.id === focusId);
  const empty: FocusedRelationshipGroups = { parents: [], partners: [], siblings: [], children: [], others: [] };
  if (!focus) return empty;

  const parentIds = new Set(uniqueIds([
    ...(focus.parentIds || []),
    ...members.filter(member => member.childrenIds?.includes(focus.id)).map(member => member.id)
  ]));
  const partnerIds = new Set(uniqueIds([
    ...getSpouseIds(focus),
    ...members.filter(member => getSpouseIds(member).includes(focus.id)).map(member => member.id)
  ]));
  const childIds = new Set(uniqueIds([
    ...(focus.childrenIds || []),
    ...members.filter(member => member.parentIds?.includes(focus.id)).map(member => member.id)
  ]));
  const focusParentIds = new Set(parentIds);
  const siblingIds = new Set(uniqueIds([
    ...(focus.siblingIds || []),
    ...members.filter(member => member.siblingIds?.includes(focus.id)).map(member => member.id),
    ...members
      .filter(member => member.id !== focus.id && member.parentIds?.some(parentId => focusParentIds.has(parentId)))
      .map(member => member.id),
    ...members
      .filter(member => member.id !== focus.id && Boolean(focus.siblingGroupId) && member.siblingGroupId === focus.siblingGroupId)
      .map(member => member.id)
  ]));

  // A stronger relationship always wins over a derived sibling relationship.
  parentIds.forEach(id => siblingIds.delete(id));
  partnerIds.forEach(id => siblingIds.delete(id));
  childIds.forEach(id => siblingIds.delete(id));

  const groups: FocusedRelationshipGroups = { parents: [], partners: [], siblings: [], children: [], others: [] };
  members.forEach(member => {
    if (member.id === focus.id) return;
    if (parentIds.has(member.id)) groups.parents.push(member);
    else if (partnerIds.has(member.id)) groups.partners.push(member);
    else if (siblingIds.has(member.id)) groups.siblings.push(member);
    else if (childIds.has(member.id)) groups.children.push(member);
    else groups.others.push(member);
  });

  Object.values(groups).forEach(group => group.sort(compareMembers));
  return groups;
}

export function relationshipLabelForFocus(
  memberId: string,
  focusId: string,
  groups: FocusedRelationshipGroups,
  fallback = 'Relative'
) {
  if (memberId === focusId) return 'Focused person';
  if (groups.parents.some(member => member.id === memberId)) return 'Parent';
  if (groups.partners.some(member => member.id === memberId)) return 'Partner / spouse';
  if (groups.siblings.some(member => member.id === memberId)) return 'Sibling';
  if (groups.children.some(member => member.id === memberId)) return 'Child';
  return fallback === 'Me' ? 'Relative' : fallback;
}

export function getTreeBounds(
  nodes: LayoutNode[],
  xSpacing: number,
  ySpacing: number,
  nodeWidth = 116,
  nodeHeight = 124
): TreeBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  const halfWidth = nodeWidth / 2;
  const halfHeight = nodeHeight / 2;
  const minX = Math.min(...nodes.map(node => node.x * xSpacing - halfWidth));
  const maxX = Math.max(...nodes.map(node => node.x * xSpacing + halfWidth));
  const minY = Math.min(...nodes.map(node => node.y * ySpacing - halfHeight));
  const maxY = Math.max(...nodes.map(node => node.y * ySpacing + halfHeight));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

export function calculateFitTransform(
  bounds: TreeBounds,
  viewportWidth: number,
  viewportHeight: number,
  padding = 32,
  minScale = 0.28,
  maxScale = 1
): TreeTransform {
  if (viewportWidth <= 0 || viewportHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return { scale: maxScale, x: 0, y: 0 };
  }

  const usableWidth = Math.max(1, viewportWidth - padding * 2);
  const usableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min(
    usableWidth / bounds.width,
    usableHeight / bounds.height
  )));

  return {
    scale,
    x: -bounds.centerX * scale,
    y: -bounds.centerY * scale
  };
}

export function computeTreeLayout(members: FamilyMember[], rootId: string = 'm1'): LayoutNode[] {
  if (members.length === 0) return [];

  const rootMember = members.find(m => m.id === rootId) || members[0];
  const spouseOffset = 1.2;
  const extraSpouseHeartOffset = 0.4;
  const siblingOffset = 1.25;
  const relativeOffset = 1.4;

  const positions = new Map<string, { x: number, y: number }>();
  const visited = new Set<string>();
  const grid = new Map<number, number[]>(); // y -> list of x
  const siblingGroups = new Map<string, string[]>();

  members.forEach(member => {
    if (!member.siblingGroupId) return;
    siblingGroups.set(member.siblingGroupId, [
      ...(siblingGroups.get(member.siblingGroupId) || []),
      member.id
    ]);
  });

  function isSpaceFree(x: number, y: number, minDistance: number = 1) {
    if (!grid.has(y)) return true;
    const row = grid.get(y)!;
    return !row.some(rx => Math.abs(rx - x) < minDistance);
  }

  function getFreeX(desiredX: number, y: number, minDistance: number = 1.2): number {
    if (!grid.has(y)) grid.set(y, []);
    let offset = 0;
    const step = 0.5;
    while (true) {
      const testX = desiredX + offset;
      if (isSpaceFree(testX, y, minDistance)) {
        grid.get(y)!.push(testX);
        return testX;
      }
      if (offset >= 0) offset = -offset - step;
      else offset = -offset;
    }
  }

  const queue: { id: string, targetX: number, targetY: number }[] = [];
  queue.push({ id: rootMember.id, targetX: 0, targetY: 0 });

  const processQueue = () => {
    while (queue.length > 0) {
      const { id, targetX, targetY } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const member = members.find(m => m.id === id);
      if (!member) continue;

      const x = getFreeX(targetX, targetY);
      positions.set(id, { x, y: targetY });

      const spouseIds = getSpouseIds(member);
      spouseIds.forEach((spouseId, index) => {
        if (!visited.has(spouseId)) {
          queue.push({ id: spouseId, targetX: x + spouseOffset * (index + 1), targetY });
        }
      });

      if (member.siblingGroupId) {
        const siblingIds = (siblingGroups.get(member.siblingGroupId) || []).filter(siblingId => siblingId !== id);
        siblingIds.forEach((siblingId, index) => {
          if (visited.has(siblingId)) return;

          const direction = index % 2 === 0 ? -1 : 1;
          const distance = Math.ceil((index + 1) / 2) * siblingOffset;
          queue.push({ id: siblingId, targetX: x + direction * distance, targetY });
        });
      }

      member.relativeIds?.forEach((relativeId, index) => {
        if (visited.has(relativeId)) return;

        const direction = index % 2 === 0 ? 1 : -1;
        const distance = Math.ceil((index + 1) / 2) * relativeOffset;
        queue.push({ id: relativeId, targetX: x + direction * distance, targetY });
      });

      if (member.parentIds && member.parentIds.length > 0) {
        const parentCount = member.parentIds.length;
        member.parentIds.forEach((parentId, idx) => {
          if (!visited.has(parentId)) {
            const offset = parentCount === 1 ? 0 : (idx === 0 ? -0.8 : 0.8);
            queue.push({ id: parentId, targetX: x + offset, targetY: targetY - 1 });
          }
        });
      }

      if (member.childrenIds && member.childrenIds.length > 0) {
        const childGroups = new Map<string, { centerX: number, childIds: string[] }>();

        member.childrenIds.forEach(childId => {
          const child = members.find(m => m.id === childId);
          if (!child || visited.has(childId)) return;

          const coParentId = child.parentIds?.find(parentId => parentId !== member.id && spouseIds.includes(parentId));
          const coParentIndex = coParentId ? spouseIds.indexOf(coParentId) : -1;
          const coParentPosition = coParentId ? positions.get(coParentId) : undefined;
          const centerX = coParentId
            ? coParentIndex > 0
              ? coParentPosition
                ? coParentPosition.x + (coParentPosition.x >= x ? -extraSpouseHeartOffset : extraSpouseHeartOffset)
                : x + (spouseOffset * (coParentIndex + 1)) - extraSpouseHeartOffset
              : coParentPosition
                ? (x + coParentPosition.x) / 2
                : x + (spouseOffset * (coParentIndex + 1)) / 2
            : x;
          const groupKey = coParentId || 'single-parent';
          const group = childGroups.get(groupKey) || { centerX, childIds: [] };

          childGroups.set(groupKey, {
            centerX,
            childIds: [...group.childIds, childId]
          });
        });

        childGroups.forEach(group => {
          let startOffset = -((group.childIds.length - 1) * 1.0) / 2;

          group.childIds.forEach(childId => {
            queue.push({ id: childId, targetX: group.centerX + startOffset, targetY: targetY + 1 });
            startOffset += 1.0;
          });
        });
      }
    }
  };

  processQueue();

  members.forEach(member => {
    if (!visited.has(member.id)) {
      queue.push({ id: member.id, targetX: 0, targetY: 0 });
      processQueue();
    }
  });

  return members.map(member => {
    const pos = positions.get(member.id) || { x: 0, y: 0 };
    return {
      member,
      x: pos.x,
      y: pos.y
    };
  });
}

export function generateConnections(nodes: LayoutNode[], X_SPACING: number, Y_SPACING: number): ConnectionLine[] {
  const lines: ConnectionLine[] = [];
  const nodeMap = new Map(nodes.map(n => [n.member.id, n]));
  const spouseLineKeys = new Set<string>();
  const relativeLineKeys = new Set<string>();
  const parentMap = new Map<string, LayoutNode[]>();
  const extraSpouseHeartOffset = X_SPACING * 0.4;

  const addParentForChild = (childId: string, parentNode: LayoutNode) => {
    if (childId === parentNode.member.id) return;

    const parents = parentMap.get(childId) || [];
    if (!parents.some(parent => parent.member.id === parentNode.member.id)) {
      parentMap.set(childId, [...parents, parentNode]);
    }
  };

  nodes.forEach(node => {
    const m = node.member;

    getSpouseIds(m).forEach(spouseId => {
      const spouse = nodeMap.get(spouseId);
      if (!spouse) return;

      const spouseKey = [m.id, spouse.member.id].sort().join('-');
      if (spouseLineKeys.has(spouseKey)) return;

      spouseLineKeys.add(spouseKey);

      const owner = getSpouseIds(m).length >= getSpouseIds(spouse.member).length ? node : spouse;
      const ownerSpouseIds = getSpouseIds(owner.member);
      const otherId = owner.member.id === m.id ? spouse.member.id : m.id;
      const spouseIndex = ownerSpouseIds.indexOf(otherId);
      const isExtraSpouse = ownerSpouseIds.length > 1 && spouseIndex > 0;
      const curve = isExtraSpouse ? -125 - ((spouseIndex - 1) * 36) : 0;
      const left = node.x <= spouse.x ? node : spouse;
      const right = left.member.id === node.member.id ? spouse : node;
      const x1 = left.x * X_SPACING;
      const y1 = left.y * Y_SPACING;
      const x2 = right.x * X_SPACING;
      const y2 = right.y * Y_SPACING;
      const extraSpouse = owner.member.id === node.member.id ? spouse : node;
      const extraSpouseX = extraSpouse.x * X_SPACING;
      const heartX = isExtraSpouse
        ? extraSpouseX >= owner.x * X_SPACING
          ? extraSpouseX - extraSpouseHeartOffset
          : extraSpouseX + extraSpouseHeartOffset
        : (x1 + x2) / 2;
      const heartY = isExtraSpouse ? y2 : (y1 + y2) / 2;

      lines.push({
        id: `spouse-${spouseKey}`,
        x1,
        y1,
        x2,
        y2,
        curve,
        heartX,
        heartY,
        type: 'spouse'
      });
    });

    m.relativeIds?.forEach(relativeId => {
      const relative = nodeMap.get(relativeId);
      if (!relative) return;

      const relativeKey = [m.id, relative.member.id].sort().join('-');
      if (relativeLineKeys.has(relativeKey)) return;
      relativeLineKeys.add(relativeKey);

      const left = node.x <= relative.x ? node : relative;
      const right = left.member.id === node.member.id ? relative : node;
      lines.push({
        id: `relative-${relativeKey}`,
        x1: left.x * X_SPACING,
        y1: left.y * Y_SPACING,
        x2: right.x * X_SPACING,
        y2: right.y * Y_SPACING,
        type: 'relative'
      });
    });

    m.childrenIds?.forEach(childId => addParentForChild(childId, node));
  });

  nodes.forEach(child => {
    child.member.parentIds?.forEach(parentId => {
      const parent = nodeMap.get(parentId);
      if (parent) addParentForChild(child.member.id, parent);
    });
  });

  const siblingGroups = new Map<string, LayoutNode[]>();
  nodes.forEach(node => {
    if (!node.member.siblingGroupId || node.member.parentIds?.length) return;
    siblingGroups.set(node.member.siblingGroupId, [
      ...(siblingGroups.get(node.member.siblingGroupId) || []),
      node
    ]);
  });

  siblingGroups.forEach((siblings, groupId) => {
    if (siblings.length < 2) return;

    const hubX = siblings.reduce((sum, sibling) => sum + sibling.x * X_SPACING, 0) / siblings.length;
    const hubY = Math.min(...siblings.map(sibling => sibling.y * Y_SPACING)) - Y_SPACING;

    siblings.forEach(sibling => {
      lines.push({
        id: `sibling-hub-${groupId}-to-${sibling.member.id}`,
        x1: hubX,
        y1: hubY,
        x2: sibling.x * X_SPACING,
        y2: sibling.y * Y_SPACING,
        heartX: hubX,
        heartY: hubY,
        type: 'sibling-hub'
      });
    });
  });

  nodes.forEach(child => {
    const parents = parentMap.get(child.member.id) || [];
    if (parents.length === 0) return;

    const parentIds = new Set(parents.map(parent => parent.member.id));
    const spouseParent = parents.find(parent => getSpouseIds(parent.member).some(spouseId => parentIds.has(spouseId)));
    const spouse = spouseParent
      ? parents.find(parent => getSpouseIds(spouseParent.member).includes(parent.member.id))
      : undefined;
    const sourceParents = spouseParent && spouse ? [spouseParent, spouse] : parents.slice(0, 2);
    const sourceKey = sourceParents.map(parent => parent.member.id).sort().join('-');
    const spouseLine = lines.find(line => line.id === `spouse-${sourceKey}`);
    const spouseLines = lines
      .filter(line => line.type === 'spouse')
      .sort((a, b) => (a.heartX ?? 0) - (b.heartX ?? 0));
    const spouseLineIndex = spouseLine ? spouseLines.findIndex(line => line.id === spouseLine.id) : -1;
    const routeOffset = spouseLineIndex > -1
      ? [0, -3, 3, -6, 6, -9, 9][spouseLineIndex] ?? ((spouseLineIndex % 2 === 0 ? 1 : -1) * Math.ceil(spouseLineIndex / 2) * 3)
      : 0;
    const startX = spouseLine?.heartX ?? sourceParents.reduce((sum, parent) => sum + parent.x * X_SPACING, 0) / sourceParents.length;
    const startY = spouseLine?.heartY ?? sourceParents.reduce((sum, parent) => sum + parent.y * Y_SPACING, 0) / sourceParents.length;

    lines.push({
      id: `child-${sourceKey}-${child.member.id}`,
      x1: startX,
      y1: startY,
      x2: child.x * X_SPACING,
      y2: child.y * Y_SPACING,
      fromHeart: Boolean(spouseLine),
      routeOffset,
      type: 'parent-child'
    });
  });

  return lines;
}
