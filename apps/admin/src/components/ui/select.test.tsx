// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Select } from './select';

function setPointer(fine: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: fine && q.includes('fine'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  setPointer(true);
  // Radix Select leans on APIs jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const opts = (
  <>
    <option value="">All</option>
    <option value="a">Alpha</option>
    <option value="b" disabled>
      Beta
    </option>
    <option value="c">Gamma</option>
  </>
);

const open = () => {
  const trigger = screen.getByRole('combobox', { name: 'Pick' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return trigger;
};

describe('Select (fine pointer)', () => {
  it('shows the label of the current value', () => {
    render(
      <Select aria-label="Pick" defaultValue="c">
        {opts}
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Pick' }).textContent).toContain('Gamma');
  });

  it('selects with the keyboard and passes the value to onChange', async () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLSelectElement>) => e.target.value);
    render(
      <Select aria-label="Pick" defaultValue="" onChange={onChange}>
        {opts}
      </Select>,
    );
    const trigger = open();
    expect(screen.getByRole('listbox')).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('option'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('option'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0]!.value).toBe('a');
    expect(trigger.textContent).toContain('Alpha');
  });

  it('writes the name and value into FormData', () => {
    render(
      <form data-testid="f">
        <Select aria-label="Pick" name="letter" defaultValue="a">
          {opts}
        </Select>
      </form>,
    );
    expect(new FormData(screen.getByTestId('f') as HTMLFormElement).get('letter')).toBe('a');
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(new FormData(screen.getByTestId('f') as HTMLFormElement).get('letter')).toBe('c');
  });

  it('does not select a disabled option', () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Pick" defaultValue="a" onChange={onChange}>
        {opts}
      </Select>,
    );
    open();
    const beta = screen.getByRole('option', { name: 'Beta' });
    expect(beta.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(beta);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('round-trips the empty choice', () => {
    const seen: string[] = [];
    function Host() {
      const [v, setV] = React.useState('c');
      return (
        <Select
          aria-label="Pick"
          name="x"
          value={v}
          onChange={(e) => {
            seen.push(e.target.value);
            setV(e.target.value);
          }}
        >
          {opts}
        </Select>
      );
    }
    render(<Host />);
    open();
    fireEvent.click(screen.getByRole('option', { name: 'All' }));
    expect(seen).toEqual(['']);
    expect(screen.getByRole('combobox', { name: 'Pick' }).textContent).toContain('All');
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(seen).toEqual(['', 'c']);
  });

  it('does not open when disabled', () => {
    render(
      <Select aria-label="Pick" disabled defaultValue="a">
        {opts}
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Pick' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('mirrors a value written to the native select (react-hook-form style)', () => {
    let ref: HTMLSelectElement | null = null;
    const { rerender } = render(
      <Select aria-label="Pick" ref={(el) => void (ref = el)}>
        {opts}
      </Select>,
    );
    ref!.value = 'c';
    act(() => rerender(
      <Select aria-label="Pick" ref={(el) => void (ref = el)}>
        {opts}
      </Select>,
    ));
    expect(screen.getByRole('combobox', { name: 'Pick' }).textContent).toContain('Gamma');
  });
});

describe('Select (coarse pointer)', () => {
  it('renders only the native select and keeps its value', () => {
    setPointer(false);
    render(
      <form data-testid="f">
        <Select aria-label="Pick" name="letter" defaultValue="c">
          {opts}
        </Select>
      </form>,
    );
    const el = screen.getByRole('combobox', { name: 'Pick' }) as HTMLSelectElement;
    expect(el.tagName).toBe('SELECT');
    fireEvent.change(el, { target: { value: 'a' } });
    expect(new FormData(screen.getByTestId('f') as HTMLFormElement).get('letter')).toBe('a');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
