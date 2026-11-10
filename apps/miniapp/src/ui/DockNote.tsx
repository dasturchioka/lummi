import { useState } from 'react';

/**
 * The note («Осталось 3», «Добавлено в корзину») rises above a dock as a small status pill and
 * fades away again, so the buttons never move under the customer's thumb. The last text stays
 * while it fades. Place it inside the dock's `relative` wrapper.
 */
export function DockNote({ text }: { text: string | undefined }) {
  const [shown, setShown] = useState(text);
  if (text && text !== shown) setShown(text);
  return (
    <>
      <span role="status" className="sr-only">
        {text ?? ''}
      </span>
      <span
        aria-hidden="true"
        data-open={text ? '' : undefined}
        className="type-caption pointer-events-none absolute bottom-full left-1/2 mb-[22px] -translate-x-1/2 translate-y-1 rounded-pill bg-btn px-3 py-1.5 font-semibold whitespace-nowrap text-btn-ink opacity-0 transition-[opacity,translate] duration-150 ease-out data-[open]:translate-y-0 data-[open]:opacity-100 data-[open]:duration-200"
      >
        {shown}
      </span>
    </>
  );
}
