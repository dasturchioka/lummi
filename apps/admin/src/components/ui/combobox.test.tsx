// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxOption } from './combobox';

afterEach(cleanup);

const options: ComboboxOption[] = [
  { value: 'v:1', label: 'Absolu Aventus · 10 ml · available 4' },
  { value: 'v:2', label: 'Absolu Aventus · 50 ml · available 0', muted: true },
  { value: 'v:3', label: 'Oʻzbek Nur · 30 ml · available 2' },
  { value: 'set:10', label: 'Discovery set 5 × 10 ml · available 1' },
];

function Host({ onPick = () => {} }: { onPick?: (v: string) => void }) {
  const [v, setV] = React.useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <Combobox
        id="c"
        value={v}
        onChange={(x) => {
          setV(x);
          onPick(x);
        }}
        options={options}
        placeholder="Search"
        emptyText="Nothing found"
      />
    </form>
  );
}

const input = () => screen.getByRole('combobox') as HTMLInputElement;
const labels = () => screen.queryAllByRole('option').map((o) => o.textContent);

describe('Combobox', () => {
  it('filters by part of a name: «aven» finds both Aventus volumes', () => {
    render(<Host />);
    fireEvent.focus(input());
    expect(labels()).toHaveLength(4);
    fireEvent.change(input(), { target: { value: 'aven' } });
    expect(labels()).toEqual([options[0]!.label, options[1]!.label]);
  });

  it('«discovery» finds the set; diacritics and apostrophes are ignored', () => {
    render(<Host />);
    fireEvent.change(input(), { target: { value: 'DISCOVERY' } });
    expect(labels()).toEqual([options[3]!.label]);
    fireEvent.change(input(), { target: { value: "o'zbek" } });
    expect(labels()).toEqual([options[2]!.label]);
  });

  it('shows the empty text when nothing matches', () => {
    render(<Host />);
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(labels()).toEqual([]);
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('keeps a zero-available item visible', () => {
    render(<Host />);
    fireEvent.focus(input());
    expect(labels()).toContain(options[1]!.label);
  });

  it('picks with arrows + Enter and does not submit the form', () => {
    const onPick = vi.fn();
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <Combobox id="c" value="" onChange={onPick} options={options} emptyText="x" />
      </form>,
    );
    fireEvent.change(input(), { target: { value: 'aven' } });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('v:2');
    expect(submit).not.toHaveBeenCalled();
  });

  it('picks by click, shows the label, and closes', () => {
    const onPick = vi.fn();
    render(<Host onPick={onPick} />);
    fireEvent.change(input(), { target: { value: 'disc' } });
    fireEvent.click(screen.getByRole('option'));
    expect(onPick).toHaveBeenCalledWith('set:10');
    expect(input().value).toBe(options[3]!.label);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes and restores the chosen label', () => {
    render(<Host />);
    fireEvent.change(input(), { target: { value: 'disc' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input().value).toBe('');
  });

  it('exposes combobox ARIA state', () => {
    render(<Host />);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    fireEvent.focus(input());
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBeTruthy();
  });
});
