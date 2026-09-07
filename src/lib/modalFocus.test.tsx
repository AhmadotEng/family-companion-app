/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocusTrap } from './modalFocus';

function ModalHarness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useModalFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: () => setOpen(false),
    escapeDisabled: busy,
  });

  return (
    <main>
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
    </main>
  );
}

function PortaledModalHarness() {
  const [open, setOpen] = useState(false);
  const scrollRootRef = useRef<HTMLElement>(null);
  const dialogRef = useModalFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: () => setOpen(false),
    scrollRoot: scrollRootRef,
  });

  return (
    <>
      <main ref={scrollRootRef} data-testid="scroll-root">
        <button type="button" onClick={() => setOpen(true)}>Open portaled planner</button>
      </main>
      {open ? createPortal(
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Portaled planner">
          <button type="button">Portaled action</button>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('isolates the modal from background content and restores page scrolling', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open planner' });
    const main = document.querySelector('main') as HTMLElement;
    let focusedWhenHidden: Element | null = null;
    vi.spyOn(trigger, 'setAttribute').mockImplementation((name, value) => {
      if (name === 'aria-hidden' && value === 'true') focusedWhenHidden = document.activeElement;
      Element.prototype.setAttribute.call(trigger, name, value);
    });

    await user.click(trigger);
    expect(focusedWhenHidden).toBe(screen.getByRole('button', { name: 'First action' }));
    expect(trigger.getAttribute('aria-hidden')).toBe('true');
    expect(trigger.inert).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-hidden')).toBeNull();
    expect(trigger.inert).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(main.style.overflow).toBe('');
  });

  it('locks an explicit scroll root when the modal is portaled to the body', async () => {
    const user = userEvent.setup();
    const { container } = render(<PortaledModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open portaled planner' });
    const scrollRoot = screen.getByTestId('scroll-root');

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Portaled planner' });
    expect(dialog.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Portaled action' }));
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(scrollRoot.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Portaled planner' })).toBeNull();
    expect(container.getAttribute('aria-hidden')).toBeNull();
    expect(scrollRoot.style.overflow).toBe('');
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
