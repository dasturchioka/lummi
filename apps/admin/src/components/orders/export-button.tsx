import type { Language } from '@lummi/i18n';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AdminMessages } from '@/lib/i18n';

/**
 * «Скачать в Excel» (#56): the orders the screen's filters match, as a file. The owner's alone
 * (the file holds names, phones and addresses), so the page shows it only to the owner.
 */
export function OrdersExportButton({
  filters,
  language,
  t,
}: {
  filters: Record<string, string | undefined>;
  language: Language;
  t: AdminMessages;
}) {
  const params = new URLSearchParams({ lang: language });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return (
    <Button asChild variant="outline">
      <a href={`/api/admin/orders/export?${params}`} download>
        <Download strokeWidth={1.5} aria-hidden />
        {t.orders.export.button}
      </a>
    </Button>
  );
}
