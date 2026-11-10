/**
 * Label divider (DESIGN.md Shapes): hairline, 4 px Sage diamond, hairline, 72 px wide. Only on
 * label lockups: the product page's name block and the set's.
 */
export function LabelDivider() {
  return (
    <div aria-hidden="true" className="mt-3 flex w-[72px] items-center gap-1.5 text-line-strong">
      <span className="h-px flex-1 bg-current" />
      <span className="size-1 rotate-45 bg-sage" />
      <span className="h-px flex-1 bg-current" />
    </div>
  );
}
