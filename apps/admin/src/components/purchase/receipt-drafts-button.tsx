'use client';

import type { PurchasePlanRow } from '@lummi/contracts';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';

/**
 * «Buy this» (#76 for #78): a draft oil receipt per plan row, its kilograms at the fragrance's oil
 * price. The drafts hold no oil; the owner confirms each on the fragrance's warehouse page as the
 * invoice reads. The server prices them; the page sends only which fragrance and how many grams.
 */
export function ReceiptDraftsButton({
  rows,
  t,
}: {
  rows: Pick<PurchasePlanRow, 'fragranceId' | 'oilKg'>[];
  t: AdminMessages;
}) {
  const p = t.purchase;
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'failed' } | { kind: 'done'; n: number }>({
    kind: 'idle',
  });
  const lines = rows
    .filter((r) => r.oilKg > 0)
    .map((r) => ({ fragranceId: r.fragranceId, grams: Math.round(r.oilKg * 1_000_000) / 1000 }));

  async function create() {
    setPending(true);
    const res = await browserApi.warehouse.draftReceipts({ body: { lines } }).catch(() => null);
    setPending(false);
    setState(res?.status === 201 ? { kind: 'done', n: res.body.created } : { kind: 'failed' });
  }

  return (
    <div className="grid gap-2">
      <p className="max-w-[70ch] text-small text-pretty text-muted-foreground">{p.draftsHint}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="outline"
          size="sm"
          loading={pending}
          disabled={lines.length === 0 || state.kind === 'done'}
          onClick={() => void create()}
        >
          {p.drafts}
        </Button>
        {state.kind === 'done' && (
          <span role="status" className="inline-flex items-center gap-1.5 text-small">
            <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
            {fill(p.draftsDone, { n: num(state.n) })}
          </span>
        )}
        {state.kind === 'failed' && (
          <span role="alert" className="text-small font-medium">
            {p.draftsFailed}
          </span>
        )}
      </div>
    </div>
  );
}
