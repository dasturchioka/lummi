'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';

/** Publish a review on the product cards, or hide it again; the server audits it with the staff member. */
export function PublishButton({
  id,
  published,
  t,
}: {
  id: number;
  published: boolean;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const r = t.reviews;

  async function toggle() {
    setSaving(true);
    setFailed(false);
    try {
      const res = await browserApi.reviews.setPublished({
        params: { id },
        body: { published: !published },
      });
      if (res.status === 200) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        size="sm"
        variant={published ? 'outline' : 'default'}
        loading={saving}
        onClick={toggle}
      >
        {published ? (
          <EyeOff strokeWidth={1.5} aria-hidden />
        ) : (
          <Eye strokeWidth={1.5} aria-hidden />
        )}
        {published ? r.hide : r.publish}
      </Button>
      {failed && (
        <p role="alert" className="text-[13px] text-alert">
          {r.failed}
        </p>
      )}
    </div>
  );
}
