'use client';

import type { AdminRegionDto } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

/** Owner-only: the delivery tariff of every region. A change is audited by the API. */
export function TariffsManager({
  initial,
  language,
  t,
}: {
  initial: AdminRegionDto[];
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminRegionDto | null>(null);
  const name = (r: AdminRegionDto) => (language === 'uz' ? r.nameUz : r.nameRu);
  return (
    <>
      <PageHeader
        title={t.tariffs.title}
        description={t.tariffs.description}
        actions={
          <Button variant="outline" asChild>
            <Link href="/bts-points">
              <ArrowLeft strokeWidth={1.5} aria-hidden />
              {t.tariffs.back}
            </Link>
          </Button>
        }
      />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>{t.tariffs.region}</TH>
              <TH className="text-right">{t.tariffs.tariff}</TH>
              <TH className="max-sm:hidden">{t.tariffs.points}</TH>
              <TH>
                <span className="sr-only">{t.btsPoints.actions}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {initial.map((r) => (
              <TR key={r.id}>
                <TD className="font-semibold [overflow-wrap:anywhere]">{name(r)}</TD>
                <TD className="text-right whitespace-nowrap">
                  {formatMoney(r.deliveryTariff, language)}
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">
                  {fill(t.tariffs.pointsCount, {
                    active: String(r.activePointCount),
                    total: String(r.pointCount),
                  })}
                </TD>
                <TD className="w-px">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                    {t.tariffs.edit}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <TariffDialog
        region={editing}
        name={editing ? name(editing) : ''}
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

function TariffDialog({
  region,
  name,
  t,
  onClose,
  onSaved,
}: {
  region: AdminRegionDto | null;
  name: string;
  t: AdminMessages;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={region !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {region && (
          <TariffForm key={region.id} region={region} name={name} t={t} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TariffForm({
  region,
  name,
  t,
  onSaved,
}: {
  region: AdminRegionDto;
  name: string;
  t: AdminMessages;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(String(region.deliveryTariff));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{1,9}$/.test(value);
  return (
    <>
      <DialogTitle>{fill(t.tariffs.editTitle, { region: name })}</DialogTitle>
      <DialogDescription className="sr-only">{t.tariffs.description}</DialogDescription>
      <form
        className="mt-5 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setPending(true);
          setError(null);
          const res = await browserApi.regions
            .setTariff({ params: { id: region.id }, body: { deliveryTariff: Number(value) } })
            .catch(() => null);
          setPending(false);
          if (res?.status === 200) onSaved();
          else setError(res?.status === 403 ? t.errors.forbidden : t.errors.generic);
        }}
      >
        <Field id="tariff-value" label={t.tariffs.tariffLabel} hint={t.tariffs.tariffHint}>
          <Input
            inputMode="numeric"
            pattern="[0-9]+"
            autoComplete="off"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {error && <Notice title={error} />}
        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.actions.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending} disabled={!valid}>
            {t.tariffs.save}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
