// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './prefs-switches';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const labels = { label: 'Тема', light: 'Светлая', dark: 'Тёмная' };

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  document.cookie = 'lummi_theme=; path=/; max-age=0';
});

describe('ThemeToggle (#74: the theme moved to the account block)', () => {
  it('is one toggle button: pressed in dark, and a press switches the page and the cookie', () => {
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle theme="light" labels={labels} />);
    const button = screen.getByRole('button', { name: 'Тема: Тёмная' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('title')).toBe('Тёмная');

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.cookie).toContain('lummi_theme=dark');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe('Светлая');

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
