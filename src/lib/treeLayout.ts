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
  type: 'parent-child' | 'spouse' | 'sibling-hub';
  curve?: number;
  heartX?: number;
  heartY?: number;
  fromHeart?: boolean;
  routeOffset?: number;
}

const uniqueIds = (ids: (string | undefined)[]) => (
  ids.filter((id, index): id is string => Boolean(id) && ids.indexOf(id) === index)
);

const getSpouseIds = (member: FamilyMember) => uniqueIds([
  member.spouseId,
  ...(member.spouseIds || [])
]);

export function computeTreeLayout(members: FamilyMember[], rootId: string = 'm1'): LayoutNode[] {
  if (members.length === 0) return [];

  const rootMember = members.find(m => m.id === rootId) || members[0];
  const spouseOffset = 1.2;
  const extraSpouseHeartOffset = 0.4;
  const siblingOffset = 1.25;

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
