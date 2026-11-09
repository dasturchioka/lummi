'use client';

import { dictionaryInputSchema, type DictionaryInput, type DictionaryItem } from '@lummi/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Language } from '@lummi/i18n';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

type Kind = 'notes' | 'families';
type Editing = { kind: Kind; item: DictionaryItem | null };

/** Notes and families: RU/UZ names and aliases, with how many fragrances use each entry. */
export function DictionaryManager({
  notes,
  families,
  language,
  t,
}: {
  notes: DictionaryItem[];
  families: DictionaryItem[];
  language: Language;
  t: AdminMessages;
}) {
  const d = t.catalog.dict;
  const router = useRouter();
  const [tab, setTab] = useState<Kind>('notes');
  const [editing, setEditing] = useState<Editing | null>(null);
  const items = tab === 'notes' ? notes : families;

  return (
    <>
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        {t.catalog.back}
      </Link>
      <PageHeader
        title={d.title}
        description={d.description}
        actions={
          <Button onClick={() => setEditing({ kind: tab, item: null })} className="max-sm:w-full">
            <Plus strokeWidth={1.5} aria-hidden />
            {tab === 'notes' ? d.addNote : d.addFamily}
          </Button>
        }
      />
      <div role="tablist" className="mb-4 inline-flex gap-1 rounded-button bg-field p-1">
        {(['notes', 'families'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'h-9 rounded-[8px] px-4 text-sm font-semibold transition-colors',
              tab === k ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {d[k]} · {(k === 'notes' ? notes : families).length}
          </button>
        ))}
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState title={d.empty} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold [overflow-wrap:anywhere]">
                    {language === 'uz' ? i.nameUz : i.nameRu}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                    {language === 'uz' ? i.nameRu : i.nameUz}
                    {i.aliases.length > 0 && ` · ${i.aliases.join(', ')}`}
                  </p>
                </div>
                <span className="mt-1 shrink-0 text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                  {fill(d.usesCount, { n: String(i.uses) })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t.catalog.edit}: ${i.nameRu}`}
                  onClick={() => setEditing({ kind: tab, item: i })}
                >
                  <Pencil strokeWidth={1.5} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <EditDialog
        editing={editing}
        t={t}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </>
  );
}

function EditDialog({
  editing,
  t,
  onClose,
  onSaved,
}: {
  editing: Editing | null;
  t: AdminMessages;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      {editing && (
        <EditContent
          key={`${editing.kind}-${editing.item?.id ?? 'new'}`}
          editing={editing}
          t={t}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function EditContent({
  editing: { kind, item },
  t,
  onSaved,
}: {
  editing: Editing;
  t: AdminMessages;
  onSaved: () => void;
}) {
  const d = t.catalog.dict;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aliasText, setAliasText] = useState((item?.aliases ?? []).join('\n'));
  const form = useForm<DictionaryInput>({
    resolver: zodResolver(dictionaryInputSchema),
    defaultValues: {
      nameRu: item?.nameRu ?? '',
      nameUz: item?.nameUz ?? '',
      aliases: item?.aliases ?? [],
    },
  });
  const errors = form.formState.errors;
  const api = kind === 'notes' ? browserApi.catalog.notes : browserApi.catalog.families;
  const title =
    kind === 'notes' ? (item ? d.editNote : d.addNote) : item ? d.editFamily : d.addFamily;

  const submit = form.handleSubmit(async (body) => {
    setPending(true);
    setError(null);
    const res = await (
      item ? api.update({ params: { id: item.id }, body }) : api.create({ body })
    ).catch(() => null);
    setPending(false);
    if (res && (res.status === 200 || res.status === 201)) onSaved();
    else setError(res?.status === 409 ? d.taken : t.errors.generic);
  });

  return (
    <DialogContent>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className="sr-only">{d.description}</DialogDescription>
      <form className="mt-5 grid gap-4" onSubmit={submit} noValidate>
        <Field
          id="dict-ru"
          label={d.nameRu}
          error={errors.nameRu ? t.catalog.errors.required : undefined}
        >
          <Input autoComplete="off" {...form.register('nameRu')} />
        </Field>
        <Field
          id="dict-uz"
          label={d.nameUz}
          error={errors.nameUz ? t.catalog.errors.required : undefined}
        >
          <Input autoComplete="off" {...form.register('nameUz')} />
        </Field>
        <Field id="dict-aliases" label={d.aliases} hint={d.aliasesHint}>
          <Textarea
            rows={3}
            value={aliasText}
            onChange={(e) => {
              setAliasText(e.target.value);
              form.setValue(
                'aliases',
                e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
            }}
          />
        </Field>
        {error && <Notice title={error} />}
        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.actions.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending}>
            {t.catalog.save}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
