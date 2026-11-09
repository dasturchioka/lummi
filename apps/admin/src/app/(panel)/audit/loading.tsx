import { Card } from '@/components/ui/card';

/** The audit page while it loads: the header, the filters card and a column of entries. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 lg:mb-8">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton mt-3 h-4 w-full max-w-md" />
      </div>
      <Card className="mb-4 p-4 lg:p-5">
        <div className="skeleton h-11 w-full rounded-button sm:hidden" />
        <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          <div className="skeleton h-11 rounded-button lg:col-span-2" />
          <div className="skeleton h-11 rounded-button lg:col-span-2" />
          <div className="skeleton h-11 rounded-button" />
          <div className="skeleton h-11 rounded-button" />
        </div>
      </Card>
      <Card className="divide-y divide-border">
        <div className="px-4 py-3.5 lg:px-5">
          <div className="skeleton h-3 w-24" />
        </div>
        {[56, 44, 64, 48, 52].map((w) => (
          <div key={w} className="px-4 py-4 lg:px-5">
            <div className="flex items-center gap-6">
              <div className="skeleton h-4" style={{ width: `${w}%` }} />
              <div className="skeleton ml-auto h-3 w-24" />
            </div>
            <div className="skeleton mt-2.5 h-3 w-2/5" />
          </div>
        ))}
      </Card>
    </div>
  );
}
