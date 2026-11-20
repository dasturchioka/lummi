import { SET_SIZE } from '@lummi/contracts/constants';

/**
 * A builder set where a photo would be: the box seen from above, five compartments on the Milk
 * Field tray. `full` (a set in the cart or an order): a slim vial stands in every compartment, in
 * Sage, the colour of a thing completed. Empty (the «Наборы» card): five open compartments, the
 * first outlined in ink, the one to fill next. Fills its parent, which owns the size and radius.
 */
export function SetTray({ full = false }: { full?: boolean }) {
  return (
    <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-field">
      <span className={`flex h-[56%] justify-between ${full ? 'w-[56%]' : 'w-[66%]'}`}>
        {Array.from({ length: SET_SIZE }, (_, i) => (
          <span
            key={i}
            className={
              full
                ? 'w-[12%] rounded-pill bg-sage'
                : `w-[16%] rounded-[3px] bg-card ${
                    i === 0
                      ? 'shadow-[inset_0_0_0_1.5px_var(--c-ink)]'
                      : 'shadow-[inset_0_0_0_1px_var(--c-line-strong)]'
                  }`
            }
          />
        ))}
      </span>
    </span>
  );
}
