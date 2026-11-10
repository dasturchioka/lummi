import { Fragment } from 'react';

/**
 * A promo code that wraps only at its joints («BLOGER_MALIKA_|NOVOGODNIY_|…»), never mid-word
 * unless one part alone is wider than the line. The break points are `<wbr>`, not characters, so
 * a code copied from the panel pastes into a blogger's post as it was.
 */
export function CodeText({ code }: { code: string }) {
  return code.split(/(?<=[_-])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}
