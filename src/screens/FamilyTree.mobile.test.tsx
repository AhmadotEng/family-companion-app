/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyMember } from '../types';

const apiMocks = vi.hoisted(() => ({
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  updateLocation: vi.fn(),
  revokeLocation: vi.fn(),
}));

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    familyApi: { ...actual.familyApi, ...apiMocks },
  };
});

import { FamilyTree } from './FamilyTree';

function member(id: string, name: string, overrides: Partial<FamilyMember> = {}): FamilyMember {
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

const family = [
  member('dad', 'Dad', { relationship: 'Parent', spouseIds: ['mom'], childrenIds: ['me', 'anas'] }),
  member('mom', 'Mom', { relationship: 'Parent', spouseIds: ['dad'], childrenIds: ['me', 'anas'] }),
  member('me', 'Ahmad Mustafa', { relationship: 'Me', parentIds: ['dad', 'mom'], siblingIds: ['anas'], spouseIds: ['wife'], childrenIds: ['child'] }),
  member('anas', 'Anas Mustafa', { relationship: 'Sibling', parentIds: ['dad', 'mom'], siblingIds: ['me'] }),
  member('wife', 'Wife', { relationship: 'Spouse', spouseIds: ['me'], childrenIds: ['child'] }),
  member('child', 'Child', { relationship: 'Child', parentIds: ['me', 'wife'] }),
  member('cousin', 'Cousin', { relationship: 'Relative' }),
];

function renderTree(selectedMembers = family) {
  return render(
    <FamilyTree
      familyId="family-1"
      familyName="Mustafa Family"
      members={selectedMembers}
      currentUserMemberId="me"
      familyRole="owner"
      onRefresh={vi.fn()}
    />,
  );
}

beforeEach(() => {
  apiMocks.createMember.mockReset();
  apiMocks.updateMember.mockReset();
  apiMocks.deleteMember.mockReset();
  apiMocks.updateLocation.mockReset();
  apiMocks.revokeLocation.mockReset();
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FamilyTree mobile interaction model', () => {
  it('puts the tree controls first, provides every 44px action, and uses a dedicated dvh canvas', () => {
    renderTree();

    expect(screen.getByText('Mustafa Family')).toBeTruthy();
    const toolbar = screen.getByRole('toolbar', { name: 'Tree controls' });
    const navigationGroup = within(toolbar).getByRole('group', { name: 'Tree navigation and zoom' });
    expect(toolbar.className).toContain('heritage-tree-toolbar');
    expect(navigationGroup.className).toContain('heritage-navigation-group');
    expect(within(toolbar).getByRole('group', { name: 'Family view' })).toBeTruthy();
    expect(toolbar.querySelector('.heritage-toolbar-secondary')?.className).toContain('min-w-0');
    expect(toolbar.querySelector('[aria-label="Family actions"]')?.className).toContain('heritage-landscape-actions');
    expect(toolbar.querySelector('.heritage-mobile-search')?.className).toContain('min-w-0');
    expect(screen.getAllByRole('button', { name: 'Location sharing settings' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Fit entire tree' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Focus on me' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Zoom in' }).className).toContain('size-11');
    expect(screen.getByRole('button', { name: 'Zoom out' }).className).toContain('size-11');
    expect(screen.getByRole('button', { name: 'Reset tree view' }).className).toContain('size-11');
    expect(screen.getByRole('button', { name: 'Open full screen' }).className).toContain('size-11');
    expect(screen.getByTestId('heritage-tree-canvas').className).toContain('touch-none');
    expect(screen.getByTestId('heritage-tree-canvas').closest('section')?.parentElement?.className).toContain('h-full');
    expect(screen.getByRole('button', { name: /Ahmad Mustafa, Focused person/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps node hit targets in screen space and connector strokes legible at a small fit scale', async () => {
    const user = userEvent.setup();
    renderTree();
    const canvas = screen.getByTestId('heritage-tree-canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 180, height: 180, left: 0, top: 0, right: 180, bottom: 180, x: 0, y: 0, toJSON: () => ({}) }),
    });

    await user.click(screen.getByRole('button', { name: 'Fit entire tree' }));
    expect(Number(canvas.getAttribute('data-tree-scale'))).toBeLessThan(0.5);

    const scaledScene = canvas.querySelector<HTMLElement>('.origin-center');
    const hitTargets = screen.getAllByTestId('heritage-node-hit-target');
    expect(hitTargets).toHaveLength(family.length);
    hitTargets.forEach(target => {
      expect(target.className).toContain('size-11');
      expect(target.style.minWidth).toBe('44px');
      expect(target.style.minHeight).toBe('44px');
      expect(scaledScene?.contains(target)).toBe(false);
    });
    expect(screen.getAllByTestId('heritage-node-screen-label')).toHaveLength(family.length);

    const connectors = scaledScene?.querySelectorAll('[data-tree-connector="true"]') || [];
    expect(connectors.length).toBeGreaterThan(0);
    connectors.forEach(connector => {
      expect(connector.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    });
  });

  it('keeps privacy controls behind a focus-trapped sheet and restores focus on Escape', async () => {
    const user = userEvent.setup();
    renderTree();
    const trigger = screen.getByText('Location', { selector: 'span' }).closest('button') as HTMLButtonElement;

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Location sharing' });
    expect(within(dialog).getByLabelText('Precision')).toBeTruthy();
    expect(within(dialog).getByLabelText('Visible to')).toBeTruthy();
    expect(within(dialog).getByText(/never background tracking/i)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Request and save location' }) as HTMLButtonElement).disabled).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Location sharing' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('consumes a direct account privacy request, opens the sheet, and restores external focus', async () => {
    const user = userEvent.setup();
    const onHandled = vi.fn();

    function PrivacyRequestHarness() {
      const [requested, setRequested] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setRequested(true)}>Open account privacy settings</button>
          <FamilyTree
            familyId="family-1"
            familyName="Mustafa Family"
            members={family}
            currentUserMemberId="me"
            familyRole="owner"
            onRefresh={vi.fn()}
            openLocationSettingsRequest={requested}
            onLocationSettingsRequestHandled={() => {
              onHandled();
              setRequested(false);
            }}
          />
        </>
      );
    }

    render(<PrivacyRequestHarness />);
    const accountTrigger = screen.getByRole('button', { name: 'Open account privacy settings' });
    await user.click(accountTrigger);

    expect(await screen.findByRole('dialog', { name: 'Location sharing' })).toBeTruthy();
    expect(onHandled).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Location sharing' })).toBeNull());
    expect(document.activeElement).toBe(accountTrigger);
  });

  it('groups relatives in List view and returns to a refocused tree when a person is tapped', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole('button', { name: 'List' }));
    const list = screen.getByTestId('heritage-list-view');
    expect(within(list).getByText('Parents')).toBeTruthy();
    expect(within(list).getByText('Partner / spouse')).toBeTruthy();
    expect(within(list).getByText('Siblings')).toBeTruthy();
    expect(within(list).getByText('Children')).toBeTruthy();
    expect(within(list).getByText('Other relatives')).toBeTruthy();

    await user.click(within(list).getByRole('button', { name: 'Focus on Anas Mustafa in tree' }));
    expect(screen.queryByTestId('heritage-list-view')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /Anas Mustafa, Focused person/ }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: /^Wife, Relative\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Child, Relative\./ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Wife, Spouse\./ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Child, Child\./ })).toBeNull();
  });

  it('uses keyboard-safe, focus-restoring mobile sheets for adding and viewing relatives', async () => {
    const user = userEvent.setup();
    renderTree();
    const addTrigger = screen.getByText('Add relative', { selector: 'span' }).closest('button') as HTMLButtonElement;

    await user.click(addTrigger);
    const addDialog = screen.getByRole('dialog', { name: 'Add relative to tree' });
    expect(addDialog.className).toContain('100dvh');
    expect(within(addDialog).getByLabelText('Full name').className).toContain('text-base');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add relative to tree' })).toBeNull());
    expect(document.activeElement).toBe(addTrigger);

    const detailsTrigger = screen.getByText('Details').closest('button') as HTMLButtonElement;
    await user.click(detailsTrigger);
    const profileDialog = screen.getByRole('dialog', { name: 'Ahmad Mustafa' });
    expect(profileDialog.className).toContain('100dvh');
    expect(within(profileDialog).getByLabelText('Full name').className).toContain('text-base');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ahmad Mustafa' })).toBeNull());
    expect(document.activeElement).toBe(detailsTrigger);
  });

  it('supports deterministic fit, zoom, pan, reset, and in-app full screen fallback', async () => {
    const user = userEvent.setup();
    renderTree();
    const canvas = screen.getByTestId('heritage-tree-canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 440, height: 620, left: 0, top: 0, right: 440, bottom: 620, x: 0, y: 0, toJSON: () => ({}) }),
    });

    await user.click(screen.getByRole('button', { name: 'Fit entire tree' }));
    const fittedScale = Number(canvas.getAttribute('data-tree-scale'));
    expect(fittedScale).toBeGreaterThan(0.12);
    expect(fittedScale).toBeLessThanOrEqual(1.05);

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(Number(canvas.getAttribute('data-tree-scale'))).toBeGreaterThan(fittedScale);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));

    const scene = canvas.querySelector<HTMLElement>('.origin-center');
    const beforePan = scene?.style.transform;
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 140, clientY: 125 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 140, clientY: 125 });
    expect(scene?.style.transform).not.toBe(beforePan);

    const beforePinch = Number(canvas.getAttribute('data-tree-scale'));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 240, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 240, clientY: 100 });
    expect(Number(canvas.getAttribute('data-tree-scale'))).toBeGreaterThan(beforePinch);

    await user.click(screen.getByRole('button', { name: 'Reset tree view' }));
    expect(canvas.getAttribute('data-tree-scale')).toBe('1.000');

    await user.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy();
    expect(canvas.closest('section')?.className).toContain('pl-[env(safe-area-inset-left)]');
    expect(canvas.closest('section')?.className).toContain('pr-[env(safe-area-inset-right)]');
    expect(canvas.closest('section')?.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(screen.getByRole('toolbar', { name: 'Tree controls' }).className).toContain('pt-[env(safe-area-inset-top)]');
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(screen.getByRole('button', { name: 'Open full screen' })).toBeTruthy();
  });

  it('handles a single-person tree without blank positioning or missing controls', () => {
    renderTree([member('me', 'Ahmad Mustafa', { relationship: 'Me' })]);
    expect(screen.getByText('1 person in your Family tree')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ahmad Mustafa, Focused person/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fit entire tree' })).toBeTruthy();
  });
});
