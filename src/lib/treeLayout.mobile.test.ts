import { describe, expect, it } from 'vitest';
import type { FamilyMember } from '../types';
import {
  calculateFitTransform,
  computeTreeLayout,
  generateConnections,
  getTreeBounds,
  groupMembersByFocus,
  relationshipLabelForFocus,
} from './treeLayout';

function member(id: string, name = id, overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id,
    name,
    age: 30,
    birthday: '1996-01-01',
    relationship: 'Relative',
    phone: '',
    email: '',
    interests: [],
    locationSharingStatus: 'Unknown',
    ...overrides,
  };
}

describe('mobile Heritage relationship grouping', () => {
  it('keeps one person focused without inventing relatives', () => {
    const only = member('me', 'Ahmad', { relationship: 'Me' });
    const groups = groupMembersByFocus([only], only.id);

    expect(groups).toEqual({ parents: [], partners: [], siblings: [], children: [], others: [] });
    expect(relationshipLabelForFocus(only.id, only.id, groups, only.relationship)).toBe('Focused person');
  });

  it('groups symmetric parents, spouses, children, full siblings, and half-siblings exactly once', () => {
    const family = [
      member('dad', 'Dad', { childrenIds: ['me', 'half'], spouseIds: ['mom', 'other-mom'] }),
      member('mom', 'Mom', { spouseIds: ['dad'], childrenIds: ['me'] }),
      member('other-mom', 'Other Mom', { spouseIds: ['dad'], childrenIds: ['half'] }),
      member('me', 'Ahmad', { relationship: 'Me', parentIds: ['dad', 'mom'], spouseIds: ['partner'], childrenIds: ['child'] }),
      member('full', 'Anas', { parentIds: ['dad', 'mom'] }),
      member('half', 'Hamad', { parentIds: ['dad', 'other-mom'] }),
      member('partner', 'Partner', { spouseIds: ['me'], childrenIds: ['child'] }),
      member('child', 'Child', { parentIds: ['me', 'partner'] }),
      member('cousin', 'Cousin'),
    ];

    const groups = groupMembersByFocus(family, 'me');
    expect(groups.parents.map(item => item.id)).toEqual(['dad', 'mom']);
    expect(groups.partners.map(item => item.id)).toEqual(['partner']);
    expect(groups.siblings.map(item => item.id)).toEqual(['full', 'half']);
    expect(groups.children.map(item => item.id)).toEqual(['child']);
    expect(groups.others.map(item => item.id)).toEqual(['cousin', 'other-mom']);
    expect(new Set(Object.values(groups).flat().map(item => item.id)).size).toBe(family.length - 1);
  });

  it('retains people with duplicate and long display names by stable id', () => {
    const longName = 'A very long repeated family display name that must be truncated visually';
    const family = [
      member('me', 'Me', { siblingIds: ['one', 'two'] }),
      member('one', longName, { siblingIds: ['me'] }),
      member('two', longName, { siblingIds: ['me'] }),
    ];

    const groups = groupMembersByFocus(family, 'me');
    expect(groups.siblings.map(item => item.id)).toEqual(['one', 'two']);
    expect(groups.siblings.map(item => item.name)).toEqual([longName, longName]);
  });
});

describe('mobile Heritage graph fitting', () => {
  it('returns finite centered bounds and a safe fit for one person', () => {
    const nodes = computeTreeLayout([member('me')], 'me');
    const bounds = getTreeBounds(nodes, 214, 152, 116, 118);
    const transform = calculateFitTransform(bounds, 440, 620, 28, 0.12, 1.05);

    expect(bounds).toMatchObject({ width: 116, height: 118, centerX: 0, centerY: 0 });
    expect(transform).toEqual({ scale: 1.05, x: -0, y: -0 });
  });

  it('fits every bound of a large multi-generation family inside a phone viewport', () => {
    const parents = [member('p1', 'Parent 1', { childrenIds: Array.from({ length: 36 }, (_, index) => `c${index}`), spouseIds: ['p2'] }), member('p2', 'Parent 2', { childrenIds: Array.from({ length: 36 }, (_, index) => `c${index}`), spouseIds: ['p1'] })];
    const children = Array.from({ length: 36 }, (_, index) => member(`c${index}`, `Child ${index}`, { parentIds: ['p1', 'p2'] }));
    const nodes = computeTreeLayout([...parents, ...children], 'c5');
    const bounds = getTreeBounds(nodes, 214, 152, 116, 250);
    const viewports = [
      { width: 440, height: 620, padding: 28 },
      { width: 390, height: 500, padding: 24 },
      { width: 360, height: 430, padding: 20 },
      { width: 768, height: 620, padding: 32 },
    ];

    viewports.forEach(viewport => {
      const transform = calculateFitTransform(bounds, viewport.width, viewport.height, viewport.padding, 0.02, 1.05);
      expect((bounds.minX * transform.scale) + transform.x).toBeGreaterThanOrEqual(-viewport.width / 2 + viewport.padding - 0.001);
      expect((bounds.maxX * transform.scale) + transform.x).toBeLessThanOrEqual(viewport.width / 2 - viewport.padding + 0.001);
      expect((bounds.minY * transform.scale) + transform.y).toBeGreaterThanOrEqual(-viewport.height / 2 + viewport.padding - 0.001);
      expect((bounds.maxY * transform.scale) + transform.y).toBeLessThanOrEqual(viewport.height / 2 - viewport.padding + 0.001);
    });
  });

  it('keeps effective spouse and parent-child connector semantics after refocusing', () => {
    const family = [
      member('dad', 'Dad', { spouseIds: ['mom'], childrenIds: ['me', 'sibling'] }),
      member('mom', 'Mom', { spouseIds: ['dad'], childrenIds: ['me', 'sibling'] }),
      member('me', 'Me', { parentIds: ['dad', 'mom'] }),
      member('sibling', 'Sibling', { parentIds: ['dad', 'mom'] }),
    ];

    for (const focusId of family.map(item => item.id)) {
      const ids = generateConnections(computeTreeLayout(family, focusId), 214, 152).map(line => line.id);
      expect(ids).toEqual(expect.arrayContaining(['spouse-dad-mom', 'child-dad-mom-me', 'child-dad-mom-sibling']));
    }
  });

  it('arranges the focused generation between parents and children with a partner beside it', () => {
    const family = [
      member('parent', 'Parent', { childrenIds: ['me', 'sibling'] }),
      member('me', 'Me', { parentIds: ['parent'], siblingIds: ['sibling'], spouseIds: ['partner'], childrenIds: ['child'] }),
      member('sibling', 'Sibling', { parentIds: ['parent'], siblingIds: ['me'] }),
      member('partner', 'Partner', { spouseIds: ['me'], childrenIds: ['child'] }),
      member('child', 'Child', { parentIds: ['me', 'partner'] }),
    ];
    const byId = new Map(computeTreeLayout(family, 'me').map(node => [node.member.id, node]));

    expect(byId.get('me')).toMatchObject({ x: 0, y: 0 });
    expect(byId.get('parent')?.y).toBeLessThan(0);
    expect(byId.get('partner')?.y).toBe(0);
    expect(byId.get('sibling')?.y).toBe(0);
    expect(byId.get('child')?.y).toBeGreaterThan(0);
  });
});
