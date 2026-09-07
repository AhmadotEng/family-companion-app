/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreparedInvitationLinks } from './PreparedInvitationLinks';

const prepared = {
  gatheringId: 'gathering-id',
  deliveryNotice: 'Nothing was sent automatically.',
  invitations: [{
    memberId: 'member-dad',
    memberName: 'Dad',
    sharePath: '/invite/private-test-token',
  }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function installClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

describe('PreparedInvitationLinks explicit controls', () => {
  it('copies only on request, reports success, and hides only on request', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    installClipboard(writeText);
    render(<PreparedInvitationLinks prepared={prepared} onDismiss={onDismiss} />);

    expect(writeText).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/invite/private-test-token`,
    ));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide prepared invitation links' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps the link visible and explains a clipboard failure', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('Clipboard denied'));
    const user = userEvent.setup();
    installClipboard(writeText);
    render(<PreparedInvitationLinks prepared={prepared} onDismiss={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect((await screen.findByRole('alert')).textContent).toContain('browser blocked clipboard access');
    expect(screen.getByText(`${window.location.origin}/invite/private-test-token`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('uses mobile-safe controls and never opens a sharing destination without an explicit action', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    installClipboard(vi.fn().mockResolvedValue(undefined));
    render(<PreparedInvitationLinks prepared={prepared} onDismiss={vi.fn()} onContinue={onContinue} />);

    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy link' }).className).toContain('min-h-11');
    expect(screen.getByRole('link', { name: 'Preview' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Open WhatsApp' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Hide prepared invitation links' }).className).toContain('size-11');

    await user.click(screen.getByRole('button', { name: 'I copied the links — view Calendar' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
