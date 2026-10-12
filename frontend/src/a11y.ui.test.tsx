// @vitest-environment happy-dom
// DOM integration tests for selected-state semantics and small-screen search entry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactNode } from 'react';

let App: ComponentType;
let WorkspaceProvider: ComponentType<{ children: ReactNode }>;
let demo: typeof import('./data/demo');
const user = () => userEvent.setup();

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'demo');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.scrollTo = vi.fn();
  demo = await import('./data/demo');
  await demo.resetDemo();
  ({ default: App } = await import('./App'));
  ({ WorkspaceProvider } = await import('./store'));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function mount() {
  render(
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>,
  );
  await screen.findByRole('heading', { name: 'Your business, in focus.' });
}
const pressed = (name: string | RegExp) =>
  within(document.getElementById('main-content')!)
    .getByRole('button', { name })
    .getAttribute('aria-pressed');

describe('selected state is exposed to assistive technology', () => {
  it('marks the current mobile bottom navigation item as the current page', async () => {
    await mount();
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' });
    expect(within(nav).getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(nav).getByRole('button', { name: 'Tasks' }).getAttribute('aria-current'),
    ).toBeNull();
    await user().click(within(nav).getByRole('button', { name: 'Tasks' }));
    expect(within(nav).getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('exposes pressed state on task layout, inbox filter, calendar, organization and settings toggles', async () => {
    await mount();
    const actor = user();
    const sidebar = document.querySelector('aside.sidebar') as HTMLElement;
    await actor.click(within(sidebar).getByRole('button', { name: 'All tasks' }));
    expect(pressed(/^List$/)).toBe('true');
    expect(pressed(/^Board$/)).toBe('false');
    await actor.click(screen.getByRole('button', { name: /^Board$/ }));
    expect(pressed(/^Board$/)).toBe('true');

    await actor.click(within(sidebar).getByRole('button', { name: /^Inbox/ }));
    expect(pressed(/^All updates/)).toBe('true');
    expect(pressed(/^Unread/)).toBe('false');
    await actor.click(screen.getByRole('button', { name: /^Unread/ }));
    expect(pressed(/^Unread/)).toBe('true');

    await actor.click(within(sidebar).getByRole('button', { name: 'Calendar' }));
    expect(pressed('Month')).toBe('true');
    await actor.click(screen.getByRole('button', { name: 'Week' }));
    expect(pressed('Week')).toBe('true');
    expect(pressed('Month')).toBe('false');

    await actor.click(within(sidebar).getByRole('button', { name: 'People' }));
    expect(pressed(/^People$/)).toBe('true');
    await actor.click(screen.getByRole('button', { name: /^Departments$/ }));
    expect(pressed(/^Departments$/)).toBe('true');
    expect(pressed(/^People$/)).toBe('false');

    await actor.click(within(sidebar).getByRole('button', { name: 'Settings' }));
    expect(pressed('Company')).toBe('true');
    expect(pressed('My account')).toBe('false');
  });
});

describe('settings layout', () => {
  it('shows attention delivery preferences only on the My account tab', async () => {
    await mount();
    const actor = user();
    const sidebar = document.querySelector('aside.sidebar') as HTMLElement;
    await actor.click(within(sidebar).getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('heading', { name: 'Attention delivery preferences' })).toBeNull();
    await actor.click(screen.getByRole('button', { name: 'Workflow' }));
    expect(screen.queryByRole('heading', { name: 'Attention delivery preferences' })).toBeNull();
    await actor.click(screen.getByRole('button', { name: 'My account' }));
    expect(
      await screen.findByRole('heading', { name: 'Attention delivery preferences' }),
    ).toBeTruthy();
  });
});

describe('navigation and search', () => {
  it('gives Workload a different icon from Connect', async () => {
    await mount();
    const sidebar = document.querySelector('aside.sidebar') as HTMLElement;
    const icon = (name: string) =>
      within(sidebar).getByRole('button', { name }).querySelector('svg')!.getAttribute('class');
    expect(icon('Workload')).not.toBe(icon('Connect'));
  });

  it('offers a touch search button that opens and focuses the workspace search', async () => {
    await mount();
    const actor = user();
    const open = screen.getByRole('button', { name: 'Open search' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    await actor.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const input = screen.getByRole('textbox', { name: 'Search workspace' });
    expect(document.activeElement).toBe(input);
    expect(input.closest('.global-search-wrap')!.classList.contains('search-open')).toBe(true);
    await actor.type(input, 'podium');
    expect(screen.getByText(/^Tasks in /)).toBeTruthy();
  });
});
