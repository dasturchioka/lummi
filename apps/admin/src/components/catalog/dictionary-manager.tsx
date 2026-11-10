'use client';

import { dictionaryInputSchema, noteInputSchema, type DictionaryInput, type DictionaryItem } from '@lummi/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { plural, stripApostrophes, type Language } from '@lummi/i18n';
import { ArrowLeft, Plus } from 'lucide-react';
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
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

type Kind = 'notes' | 'families';
type Editing = { kind: Kind; item: DictionaryItem | null };

/**
 * Notes and families: RU/UZ names and aliases, with how many fragrances use each entry. A row (or
 * its name) opens the editor, as on the BTS points list.
 */
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
  // the dictionaries load whole, so the search is client-side; apostrophe variants compare equal
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const fold = (x: string) => stripApostrophes(x).toLocaleLowerCase();
  const all = tab === 'notes' ? notes : families;
  const needle = fold(q.trim());
  const items = needle
    ? all.filter((i) => [i.nameRu, i.nameUz, ...i.aliases].some((x) => fold(x).includes(needle)))
    : all;

  const add = () => setEditing({ kind: tab, item: null });
  const addLabel = tab === 'notes' ? d.addNote : d.addFamily;
  const name = (i: DictionaryItem) => (language === 'uz' ? i.nameUz : i.nameRu);
  const otherName = (i: DictionaryItem) => (language === 'uz' ? i.nameRu : i.nameUz);

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.description}
        titleAction={
          <Button size="icon" aria-label={addLabel} onClick={add}>
            <Plus strokeWidth={1.5} aria-hidden />
          </Button>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/catalog">
                <ArrowLeft strokeWidth={1.5} aria-hidden />
                {t.catalog.back}
              </Link>
            </Button>
            <Button onClick={add} className="max-sm:hidden">
              <Plus strokeWidth={1.5} aria-hidden />
              {addLabel}
            </Button>
          </>
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
              'h-9 rounded-[7px] px-4 text-sm font-semibold transition-colors duration-150',
              tab === k ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {d[k]}
            <span className="ml-1.5 font-medium tabular-nums opacity-70">
              {(k === 'notes' ? notes : families).length}
            </span>
          </button>
        ))}
      </div>
      <Card className="mb-4 p-4">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draft);
          }}
        >
          <Field id="d-q" label={t.catalog.search}>
            <Input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={d.searchPlaceholder}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" className="max-sm:flex-1">
              {t.catalog.apply}
            </Button>
            {q && (
              <Button
                type="button"
                variant="outline"
                className="max-sm:flex-1"
                onClick={() => {
                  setDraft('');
                  setQ('');
                }}
              >
                {t.catalog.reset}
              </Button>
            )}
          </div>
        </form>
      </Card>
      {items.length === 0 ? (
        <EmptyState title={q ? t.catalog.empty : d.empty}>
          {q ? t.catalog.emptyFilteredText : null}
        </EmptyState>
      ) : (
        <Card>
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums sm:px-5">
            {fill(t.catalog.total, { n: String(items.length) })}
          </p>
          {/* a tap anywhere on an entry opens it; the name is the keyboard path */}
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li
                key={i.id}
                onClick={() => setEditing({ kind: tab, item: i })}
                className="flex cursor-pointer items-start gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-milk/60 active:bg-milk sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: tab, item: i });
                    }}
                    aria-label={`${t.catalog.edit}: ${name(i)}`}
                    className="rounded-sm text-left font-semibold break-words underline-offset-[3px] hover:underline"
                  >
                    {name(i)}
                  </button>
                  <MetaLine
                    className="mt-0.5 text-small text-muted-foreground"
                    parts={[otherName(i), ...i.aliases]}
                  />
                </div>
                <span className="shrink-0 pt-px text-small whitespace-nowrap text-muted-foreground tabular-nums">
                  {i.uses > 0 ? plural(language, i.uses, d.usesCount) : d.unused}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
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
    resolver: zodResolver(kind === 'notes' ? noteInputSchema : dictionaryInputSchema),
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
    <DialogContent
      // editing opens on the entry, not in its name field: no keyboard over the form on a phone,
      // and the name is not pre-selected for an accidental overwrite
      onOpenAutoFocus={(e) => {
        if (!item) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).focus();
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className="sr-only">{d.description}</DialogDescription>
      <form className="mt-5 grid gap-4" onSubmit={submit} noValidate>
        <Field
          id="dict-ru"
          label={d.nameRu}
          error={errors.nameRu ? (errors.nameRu.message === 'comma_in_note' ? d.noComma : t.catalog.errors.required) : undefined}
        >
          <Input autoComplete="off" {...form.register('nameRu')} />
        </Field>
        <Field
          id="dict-uz"
          label={d.nameUz}
          error={errors.nameUz ? (errors.nameUz.message === 'comma_in_note' ? d.noComma : t.catalog.errors.required) : undefined}
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
