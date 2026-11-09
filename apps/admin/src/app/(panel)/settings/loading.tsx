import { Card } from '@/components/ui/card';

/** The settings page while it loads: the header, the area chips and an area of setting rows. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 lg:mb-8">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton mt-3 h-4 w-full max-w-md" />
      </div>
      <div className="mb-6 flex gap-2 overflow-hidden">
        {[88, 120, 72, 112, 96].map((w) => (
          <div key={w} className="skeleton h-[34px] shrink-0 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <Card>
        <div className="px-4 pt-5 lg:px-5">
          <div className="skeleton h-3.5 w-28" />
        </div>
        <div className="divide-y divide-border">
          {[72, 56, 64].map((w) => (
            <div
              key={w}
              className="grid gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10 lg:px-5"
            >
              <div>
                <div className="skeleton h-4" style={{ width: `${w}%` }} />
                <div className="skeleton mt-2.5 h-3 w-4/5" />
                <div className="skeleton mt-2 h-3 w-2/5" />
              </div>
              <div>
                <div className="skeleton h-11 w-full rounded-button" />
                <div className="skeleton mt-3 h-9 w-28 rounded-button" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
