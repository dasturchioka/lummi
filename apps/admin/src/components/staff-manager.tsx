'use client';

import type { StaffDto } from '@lummi/contracts';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';

export function StaffManager({
  initial,
  meId,
  t,
}: {
  initial: StaffDto[];
  meId: number;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [telegramId, setTelegramId] = useState('');
  const [name, setName] = useState('');

  const fail = (status: number) =>
    setError(
      status === 409 ? t.errors.conflict : status === 403 ? t.errors.forbidden : t.errors.generic,
    );
  const run = (call: () => Promise<{ status: number }>) =>
    start(async () => {
      setError(null);
      const res = await call();
      if (res.status >= 400) return fail(res.status);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await browserApi.admin.staff.create({
                body: { telegramId: Number(telegramId), name },
              });
              if (res.status === 201) {
                setTelegramId('');
                setName('');
              }
              return res;
            });
          }}
        >
          <label className="grid gap-1 text-sm">
            {t.staff.telegramId}
            <Input
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              className="w-48"
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t.staff.name}
            <Input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-60"
            />
          </label>
          <Button type="submit" disabled={pending}>
            {t.staff.add}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </Card>

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>{t.staff.name}</TH>
              <TH>{t.staff.telegramId}</TH>
              <TH>{t.staff.role}</TH>
              <TH>{t.staff.status}</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {initial.length === 0 && (
              <TR>
                <TD colSpan={5} className="text-muted-foreground">
                  {t.staff.empty}
                </TD>
              </TR>
            )}
            {initial.map((s) => (
              <TR key={s.id}>
                <TD className="font-semibold">{s.name}</TD>
                <TD className="tabular-nums">{s.telegramId}</TD>
                <TD>{t.roles[s.role]}</TD>
                <TD>
                  <Badge tone={s.active ? 'sage' : 'neutral'}>
                    {s.active ? t.staff.active : t.staff.inactive}
                  </Badge>
                </TD>
                <TD className="space-x-2 text-right">
                  {s.role === 'manager' && s.id !== meId && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            browserApi.admin.staff.update({
                              params: { id: s.id },
                              body: { active: !s.active },
                            }),
                          )
                        }
                      >
                        {s.active ? t.staff.deactivate : t.staff.activate}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(t.staff.confirmRemove)) {
                            run(() => browserApi.admin.staff.remove({ params: { id: s.id } }));
                          }
                        }}
                      >
                        {t.staff.remove}
                      </Button>
                    </>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
