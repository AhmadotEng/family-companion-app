/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { More } from './More';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('More mobile account page', () => {
  it('shows a compact account surface without the obsolete sign-out placeholder', () => {
    render(<More user={{ id: 'user-1', displayName: 'Ahmad Mustafa', email: 'ahmad@example.test' }} />);

    expect(screen.getByRole('region', { name: 'Account profile' })).toBeTruthy();
    expect(screen.getByText('Ahmad Mustafa')).toBeTruthy();
    expect(screen.getByText('ahmad@example.test')).toBeTruthy();
    const settings = screen.getByRole('region', { name: 'Account settings' });
    expect(within(settings).getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByText(/Use header to sign out/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(within(settings).getByRole('button', { name: 'Privacy and safety' }).className).toContain('min-h-14');
  });

  it('preserves the existing placeholder behavior with sentence-case labels', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<More user={{ id: 'user-1', displayName: 'Ahmad', email: 'ahmad@example.test' }} />);

    await user.click(screen.getByRole('button', { name: 'Language: English only' }));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('English-only'));
    await user.click(screen.getByRole('button', { name: 'Family settings' }));
    expect(alert).toHaveBeenLastCalledWith(expect.stringContaining('visual placeholder'));
  });
});
