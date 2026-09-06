/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { useModalFocusTrap } from './modalFocus';

function ModalHarness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useModalFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: () => setOpen(false),
    escapeDisabled: busy,
  });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open planner</button>
      {open ? (
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Planner">
          <button type="button">First action</button>
          <input aria-label="Planner title" />
          <button type="button">Last action</button>
        </div>
      ) : null}
    </div>
  );
}

afterEach(() => cleanup());

describe('useModalFocusTrap', () => {
  it('moves focus inside, closes on Escape, and restores the trigger focus', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open planner' });

    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First action' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Shift+Tab at the start and Tab at the end', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open planner' }));
    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });

    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it('does not close on Escape while the modal operation is busy', async () => {
    const user = userEvent.setup();
    render(<ModalHarness busy />);
    await user.click(screen.getByRole('button', { name: 'Open planner' }));

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Planner' })).toBeTruthy();
  });
});
