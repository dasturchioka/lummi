import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Segmented } from './Segmented';

afterEach(cleanup);

it('Segmented marks the chosen option and moves with the arrow keys', () => {
  const onChange = vi.fn();
  render(
    <Segmented
      label="Язык"
      value="ru"
      onChange={onChange}
      options={[
        { value: 'ru', label: 'RU' },
        { value: 'uz', label: 'UZ' },
      ]}
    />,
  );
  expect(screen.getByRole('radio', { name: 'RU' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.keyDown(screen.getByRole('radio', { name: 'RU' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenCalledWith('uz');
});
