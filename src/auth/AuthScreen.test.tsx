/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../types';
import { AuthScreen } from './AuthScreen';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: authMocks.login,
      register: authMocks.register,
    },
  };
});

const session: AuthSession = {
  user: {
    id: 'user-1',
    email: 'ahmad@example.test',
    displayName: 'Ahmad',
  },
  families: [{
    id: 'family-1',
    name: 'Mustafa Family',
    role: 'owner',
    linkedMemberId: 'member-1',
  }],
  activeFamilyId: 'family-1',
};

beforeEach(() => {
  authMocks.login.mockReset();
  authMocks.register.mockReset();
});

afterEach(cleanup);

describe('AuthScreen mobile accessibility', () => {
  it('uses the standalone safe-area shell, readable inputs, and 44px sentence-case controls', async () => {
    const user = userEvent.setup();
    const { container } = render(<AuthScreen onAuthenticated={vi.fn()} />);
    const main = container.querySelector('main');

    expect(main?.className).toContain('standalone-page');
    expect(main?.className).toContain('auth-screen');

    const signInTab = screen.getByRole('tab', { name: 'Sign in' });
    const registerTab = screen.getByRole('tab', { name: 'Register' });
    expect(signInTab.className).toContain('min-h-11');
    expect(registerTab.className).toContain('min-h-11');
    expect(signInTab.className).not.toContain('uppercase');

    for (const input of [screen.getByLabelText('Email'), screen.getByLabelText('Password')]) {
      expect(input.className).toContain('min-h-11');
      expect(input.className).toContain('text-base');
    }
    const submit = screen.getByRole('button', { name: 'Sign in securely' });
    expect(submit.className).toContain('min-h-11');
    expect(submit.className).not.toContain('uppercase');

    await user.click(registerTab);
    expect(screen.getByRole('heading', { name: 'Create your family space' })).toBeTruthy();
    expect(screen.getByLabelText('Your name').className).toContain('text-base');
    expect(screen.getByLabelText('Family space name').className).toContain('text-base');
    expect(screen.getByRole('button', { name: 'Create private space' }).className).toContain('min-h-11');
  });

  it('retains the sign-in behavior after the mobile presentation change', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    authMocks.login.mockResolvedValue(session);
    render(<AuthScreen onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText('Email'), 'ahmad@example.test');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in securely' }));

    await waitFor(() => expect(authMocks.login).toHaveBeenCalledWith({
      email: 'ahmad@example.test',
      password: 'secret-password',
    }));
    expect(onAuthenticated).toHaveBeenCalledWith(session);
  });

  it('defines a dynamic viewport, safe-area padding, and horizontal overflow guard', () => {
    const styles = readFileSync('src/index.css', 'utf8');
    const standaloneStart = styles.indexOf('.standalone-page {');
    const authStart = styles.indexOf('.auth-screen {');
    const publicStart = styles.indexOf('.public-invitation-screen {');

    expect(standaloneStart).toBeGreaterThanOrEqual(0);
    expect(authStart).toBeGreaterThan(standaloneStart);
    expect(publicStart).toBeGreaterThan(authStart);
    const standaloneRule = styles.slice(standaloneStart, authStart);
    expect(standaloneRule).toContain('min-height: 100dvh');
    expect(standaloneRule).toContain('overflow-x: clip');
    expect(standaloneRule).toMatch(/padding-top:[^;]*safe-area-inset-top/);
    expect(standaloneRule).toMatch(/padding-right:[^;]*safe-area-inset-right/);
    expect(standaloneRule).toMatch(/padding-bottom:[^;]*safe-area-inset-bottom/);
    expect(standaloneRule).toMatch(/padding-left:[^;]*safe-area-inset-left/);
  });
});
