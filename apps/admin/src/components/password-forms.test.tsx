// @vitest-environment jsdom
import { adminMessages } from '@lummi/i18n/admin';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';
import { PasswordChangeForm } from './password-change-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const t = adminMessages.ru.admin;
afterEach(cleanup);

/** The form around the password field: it must post, so a submit before hydration leaks nothing. */
const formOf = (container: HTMLElement) =>
  container.querySelector('input[type="password"]')?.closest('form');

describe('password forms post (ADR 0038)', () => {
  it('the sign-in form', () => {
    const { container } = render(<LoginForm t={t} language="ru" botUsername="" devLogin={false} />);
    expect(formOf(container)?.method).toBe('post');
  });

  it('the password change form', () => {
    const { container } = render(
      <PasswordChangeForm
        t={t}
        language="ru"
        login="dilnoza"
        minLength={8}
        requireCurrent
        submitLabel={t.profile.submit}
        onDone={() => {}}
      />,
    );
    const forms = container.querySelectorAll('form');
    expect(forms).toHaveLength(1);
    expect(formOf(container)?.method).toBe('post');
  });
});
