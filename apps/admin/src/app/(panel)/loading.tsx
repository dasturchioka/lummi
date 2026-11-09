import { Card } from '@/components/ui/card';

/** Loading pattern for every panel screen: the header and a table-shaped card, breathing. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 lg:mb-8">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton mt-3 h-4 w-full max-w-md" />
      </div>
      <Card className="divide-y divide-border">
        {[64, 48, 56, 40].map((w) => (
          <div key={w} className="flex h-14 items-center gap-6 px-5">
            <div className="skeleton h-4" style={{ width: `${w}%` }} />
            <div className="skeleton ml-auto h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}
