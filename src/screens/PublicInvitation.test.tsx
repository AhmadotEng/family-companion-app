/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicInvitation } from '../engagementTypes';
import { PublicInvitationScreen } from './PublicInvitation';

const engagementMocks = vi.hoisted(() => ({
  getPublicInvitation: vi.fn(),
  respondToInvitation: vi.fn(),
}));

vi.mock('../api/engagement', () => ({
  engagementApi: engagementMocks,
}));

const invitation: PublicInvitation = {
  familyName: 'Mustafa Family',
  inviteeName: 'Layla',
  hostName: 'Ahmad',
  title: 'Golden Park family afternoon',
  purpose: 'Spend time together',
  startAt: '2099-09-12T17:00:00+04:00',
  timezone: 'Asia/Dubai',
  locationName: 'Golden Park',
  notes: 'Meet by the main gate.',
  type: 'Outdoor activity',
  status: 'pending',
};

beforeEach(() => {
  engagementMocks.getPublicInvitation.mockReset();
  engagementMocks.respondToInvitation.mockReset();
  engagementMocks.getPublicInvitation.mockResolvedValue({ invitation });
  engagementMocks.respondToInvitation.mockResolvedValue({
    status: 'maybe',
    message: 'Your response was saved.',
  });
});

afterEach(cleanup);

describe('PublicInvitationScreen mobile accessibility', () => {
  it('keeps invitation content narrow, readable, and exposes 44px sentence-case RSVP actions', async () => {
    const { container } = render(<PublicInvitationScreen token="invite-token" />);

    expect(await screen.findByRole('heading', { name: invitation.title })).toBeTruthy();
    const main = container.querySelector('main');
    expect(main?.className).toContain('standalone-page');
    expect(main?.className).toContain('public-invitation-screen');
    expect(screen.getByText('Mustafa Family invitation').className).not.toContain('uppercase');
    expect(screen.getByText('Date and time').className).not.toContain('uppercase');
    expect(screen.getByRole('heading', { name: 'Your RSVP' }).className).not.toContain('uppercase');

    for (const label of ['Going', 'Maybe', 'Cannot go']) {
      const button = screen.getByRole('button', { name: label });
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('text-sm');
      expect(button.className).not.toContain('uppercase');
    }
  });

  it('retains RSVP behavior and updates the selected response', async () => {
    const user = userEvent.setup();
    render(<PublicInvitationScreen token="invite-token" />);
    const maybeButton = await screen.findByRole('button', { name: 'Maybe' });

    await user.click(maybeButton);

    await waitFor(() => expect(engagementMocks.respondToInvitation).toHaveBeenCalledWith('invite-token', 'maybe'));
    expect((await screen.findByRole('status')).textContent).toContain('Your response was saved.');
    expect(screen.getByRole('button', { name: 'Maybe' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an accessible invalid-link state without making a request', async () => {
    render(<PublicInvitationScreen token="" />);

    expect(await screen.findByRole('heading', { name: 'Invitation unavailable' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('incomplete or invalid');
    expect(engagementMocks.getPublicInvitation).not.toHaveBeenCalled();
  });
});
