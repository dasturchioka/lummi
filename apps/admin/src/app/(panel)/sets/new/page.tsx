import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { SetForm } from '@/components/sets-manager';
import { Section } from '@/components/ui/section';
import { getAdminMessages } from '@/lib/i18n';
import { getMe, serverApi } from '@/lib/server-api';

/** A new Discovery set (ADR 0044): the same form as a set's own, plus the ml of its vials. */
export default async function NewSetPage() {
  const me = await getMe();
  if (me.status === 401) redirect('/login');
  // adding a set is the owner's; the API refuses a manager's as well
  if (me.status !== 200 || me.body.role !== 'owner') redirect('/sets');
  const list = await (await serverApi()).catalog.fragrances.list({ query: {} });
  const options =
    list.status === 200 ? list.body.map((f) => ({ id: f.id, name: f.name, hidden: f.hidden })) : [];
  const { language, t } = await getAdminMessages();
  return (
    <>
      <PageHeader title={t.sets.newTitle} description={t.sets.newDescription} />
      <Section title={t.sets.priceTitle} className="max-w-2xl">
        <SetForm set={null} options={options} language={language} t={t} />
      </Section>
    </>
  );
}
