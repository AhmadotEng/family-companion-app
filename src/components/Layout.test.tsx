/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

afterEach(cleanup);

function relativeLuminance(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map(channel => Number.parseInt(channel, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map(channel => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe('Layout mobile shell', () => {
  it('shows five primary destinations and keeps secondary destinations in the account menu', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    const onSignOut = vi.fn();
    const onOpenLocationSettings = vi.fn();
    render(
      <Layout
        activeTab="home"
        setActiveTab={setActiveTab}
        title="Family Dashboard"
        onSignOut={onSignOut}
        onOpenLocationSettings={onOpenLocationSettings}
        accountName="Ahmad"
      >
        <p>Page content</p>
      </Layout>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const navButtons = within(navigation).getAllByRole('button');
    expect(navButtons).toHaveLength(5);
    expect(navButtons.map(button => button.textContent)).toEqual([
      'Home',
      'Family',
      'Gatherings',
      'Memories',
      'Activities',
    ]);
    expect(within(navigation).getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(navButtons.every(button => button.className.split(' ').includes('text-xs'))).toBe(true);
    expect(navButtons.every(button => !button.className.split(' ').includes('text-[10px]'))).toBe(true);
    expect(within(navigation).getByRole('button', { name: 'Family' }).className).toContain('text-ink/65');

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    expect(within(menu).getByRole('menuitem', { name: 'Profile and account' }).hidden).toBe(false);
    expect(within(menu).getByRole('menuitem', { name: 'Privacy and location' }).hidden).toBe(false);
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect((within(menu).getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(within(menu).getByRole('menuitem', { name: 'Privacy and location' }));
    expect(onOpenLocationSettings).toHaveBeenCalledTimes(1);
    expect(setActiveTab).not.toHaveBeenCalledWith('tree');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open account menu' }));
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(within(navigation).getByRole('button', { name: 'Memories' }));
    expect(setActiveTab).toHaveBeenCalledWith('archive');

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard dismissal, restores focus, and exposes 44px-or-larger controls', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Layout activeTab="activities" setActiveTab={vi.fn()} title="Family Activities" onSignOut={vi.fn()}>
        <p>Activities content</p>
      </Layout>,
    );
    const accountButton = screen.getByRole('button', { name: 'Open account menu' });
    const header = container.querySelector('header');
    const main = container.querySelector('main');
    const activeScreen = main?.firstElementChild as HTMLElement | null;
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });

    expect(accountButton.className).toContain('app-account-trigger');
    expect(header?.className).toContain('app-shell-header');
    expect(header?.querySelector('.app-shell-brand')).toBeTruthy();
    expect(navigation.className).toContain('app-bottom-nav');
    expect(main?.dataset.activeTab).toBe('activities');
    expect(activeScreen?.dataset.screen).toBe('activities');

    await user.click(accountButton);
    expect(accountButton.className).toContain('text-gold-ink');
    expect(screen.queryByText('Heritage & Harmony')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Profile and account' }).className).not.toContain('app-account-trigger');
    expect(accountButton.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(accountButton);

    expect(screen.getByRole('button', { name: 'Activities' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Activities' }).className).toContain('min-h-14');
    expect(accountButton.className).toContain('size-11');
    expect(container.firstElementChild?.className).toContain('h-[100dvh]');
  });

  it('gives AI Helper a bounded flex viewport instead of a second page scroller', () => {
    const { container } = render(
      <Layout activeTab="assistant" setActiveTab={vi.fn()} title="AI Helper" onSignOut={vi.fn()}>
        <div data-testid="assistant-slot" className="flex min-h-0 flex-1">Assistant</div>
      </Layout>,
    );

    const main = container.querySelector('main');
    const content = main?.firstElementChild as HTMLElement | null;
    expect(main?.className).toContain('overflow-y-hidden');
    expect(content?.className).toContain('h-full');
    expect(content?.className).toContain('overflow-hidden');
    expect(screen.getByTestId('assistant-slot').className).toContain('flex-1');
  });

  it('keeps short-landscape compaction scoped and safe-area aware', () => {
    const styles = readFileSync('src/index.css', 'utf8');
    const shortStart = styles.indexOf('@media (orientation: landscape) and (max-height: 500px) and (max-width: 1023px)');
    const narrowStart = styles.indexOf('@media (orientation: landscape) and (max-height: 500px) and (max-width: 820px)');
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');

    expect(shortStart).toBeGreaterThanOrEqual(0);
    expect(narrowStart).toBeGreaterThan(shortStart);
    expect(reducedMotionStart).toBeGreaterThan(narrowStart);

    const shortLandscape = styles.slice(shortStart, narrowStart);
    const narrowHeritage = styles.slice(narrowStart, reducedMotionStart);
    expect(shortLandscape).toMatch(/\.app-shell-brand h1\s*\{/);
    expect(shortLandscape).toMatch(/\.app-shell-tagline\s*\{/);
    expect(shortLandscape).toMatch(/\.app-account-trigger\s*\{/);
    expect(shortLandscape).not.toMatch(/\.app-shell-header\s+(?:h1|p|button)\s*\{/);
    expect(shortLandscape).toMatch(/\.app-shell-header\s*\{[^}]*safe-area-inset-top[^}]*safe-area-inset-right[^}]*safe-area-inset-left[^}]*\}/s);
    expect(shortLandscape).toMatch(/\.app-bottom-nav\s*\{[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom[^}]*safe-area-inset-left[^}]*\}/s);
    expect(shortLandscape).toMatch(/main > \[data-screen\]\s*\{[^}]*padding-top:\s*0\.5rem;[^}]*padding-bottom:\s*0\.25rem;/s);
    expect(shortLandscape).toMatch(/main \.app-screen-heading\s*\{[^}]*clip-path:\s*inset\(50%\);/s);
    expect(shortLandscape).toContain('.assistant-reconnection-panel');
    expect(shortLandscape).toContain('.assistant-quick-prompts');
    expect(narrowHeritage).toMatch(/\.heritage-tree-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(narrowHeritage).toMatch(/\.heritage-toolbar-secondary\s*\{[^}]*width:\s*100%;[^}]*flex:\s*1 0 100%;/s);
    expect(narrowHeritage).toMatch(/\.heritage-mobile-search\s*\{[^}]*min-width:\s*0;/s);
  });

  it('keeps brand gold decorative and provides a readable semantic gold token', () => {
    const styles = readFileSync('src/index.css', 'utf8');
    const readableGold = styles.match(/--color-gold-ink:\s*(#[0-9a-f]{6})/i)?.[1];
    const readableMutedInk = styles.match(/--color-ink-muted:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(readableGold).toBeTruthy();
    expect(readableMutedInk).toBeTruthy();
    expect(contrastRatio(readableGold!.slice(1), 'FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readableGold!.slice(1), 'F7F5F0')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readableMutedInk!.slice(1), 'FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readableMutedInk!.slice(1), 'F7F5F0')).toBeGreaterThanOrEqual(4.5);
    expect(styles).toContain('.text-ink\\/40');
    expect(styles).toContain('color: var(--color-ink-muted);');

    const { container } = render(
      <Layout activeTab="home" setActiveTab={vi.fn()} title="Family Dashboard" onSignOut={vi.fn()}>
        <p>Page content</p>
      </Layout>,
    );
    const brandMark = container.querySelector('.app-shell-brand img');
    const brandWord = container.querySelector('.app-shell-brand h1');
    expect(brandMark?.getAttribute('src')).toBe('/assets/ailah-mark.png');
    expect(brandWord?.className).toContain('text-ink');
  });

  it('uses the readable gold token for visible keyboard focus across modified UI', () => {
    const sourceFiles = [
      'src/auth/AuthScreen.tsx',
      'src/App.tsx',
      'src/components/GatheringPlanner.tsx',
      'src/components/Layout.tsx',
      'src/components/PreparedInvitationLinks.tsx',
      'src/components/ReconnectionPlansPanel.tsx',
      'src/screens/Activities.tsx',
      'src/screens/Assistant.tsx',
      'src/screens/Calendar.tsx',
      'src/screens/FamilyTree.tsx',
      'src/screens/Home.tsx',
      'src/screens/MemoriesRewards.tsx',
      'src/screens/More.tsx',
    ];
    const sources = sourceFiles.map(file => readFileSync(file, 'utf8')).join('\n');

    expect(sources).not.toMatch(/focus(?:-visible|-within)?:(?:ring|outline|border)-gold(?!-)/);
    expect(sources).not.toMatch(/focus(?:-visible|-within)?:(?:ring|outline|border)-gold-ink\//);
    expect(sources).toContain('focus-visible:ring-gold-ink');
    expect(sources).toContain('focus-visible:outline-gold-ink');
    expect(sources).toContain('focus:ring-gold-ink');
  });
});
