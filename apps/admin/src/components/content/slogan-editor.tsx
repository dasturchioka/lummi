'use client';

import { SLOGAN_MAX, sloganInputSchema, type Slogan } from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';

export function SloganEditor({ slogan, t }: { slogan: Slogan; t: AdminMessages }) {
  const c = t.content;
  const [ru, setRu] = useState(slogan.ru);
  const [uz, setUz] = useState(slogan.uz);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'invalid'>('idle');
  const save = async () => {
    const parsed = sloganInputSchema.safeParse({ ru, uz });
    if (!parsed.success) return setState('invalid');
    setState('saving');
    const res = await browserApi.content.slogan.set({ body: parsed.data });
    if (res.status === 200) {
      setRu(res.body.ru);
      setUz(res.body.uz);
      setState('saved');
    } else setState(res.status === 422 ? 'invalid' : 'failed');
  };
  return (
    <Card className="grid gap-5 p-4 sm:p-6" data-section="slogan">
      <div>
        <h2 className="text-base font-semibold">{c.slogan.section}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{c.slogan.hint}</p>
      </div>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field
          id="slogan-ru"
          label={c.slogan.ru}
          // what fits one line on a 360 px phone, counted as the owner types
          hint={fill(c.slogan.count, { n: String(ru.length), max: String(SLOGAN_MAX.ru) })}
          error={state === 'invalid' && !ru.trim() ? c.required : undefined}
        >
          <Input
            value={ru}
            maxLength={SLOGAN_MAX.ru}
            lang="ru"
            onChange={(e) => setRu(e.target.value)}
          />
        </Field>
        <Field
          id="slogan-uz"
          label={c.slogan.uz}
          // what fits one line on a 360 px phone, counted as the owner types
          hint={fill(c.slogan.count, { n: String(uz.length), max: String(SLOGAN_MAX.uz) })}
          error={state === 'invalid' && !uz.trim() ? c.required : undefined}
        >
          <Input
            value={uz}
            maxLength={SLOGAN_MAX.uz}
            lang="uz"
            onChange={(e) => setUz(e.target.value)}
          />
        </Field>
        {state === 'failed' && <Notice className="sm:col-span-2" title={c.failed} />}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={state === 'saving'}>
            {state === 'saving' ? c.saving : c.save}
          </Button>
          {state === 'saved' && (
            <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
              <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {c.saved}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
