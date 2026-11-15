import { notFound, redirect } from 'next/navigation';
import { PageEditor } from '@/components/content/page-editor';
import type { PlaceholderSettings } from '@/components/content/placeholders';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function EditInfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const api = await serverApi();
  const [res, settings] = await Promise.all([api.content.pages.list(), api.settings.list()]);
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/');
  if (res.status !== 200) throw new Error('content failed to load');
  const page = res.body.find((p) => p.slug === slug);
  if (!page) notFound();
  // The settings behind the placeholders, for the preview only: without them it shows the names.
  const value = (key: string) =>
    settings.status === 200 ? settings.body.find((s) => s.key === key)?.value : undefined;
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const manager = value('shop.managerUsername');
  const fills: PlaceholderSettings = {
    threshold: num(value('pricing.freeDeliveryThreshold')),
    tariff: num(value('delivery.defaultTariff')),
    manager: typeof manager === 'string' ? manager : undefined,
    reserveSeconds: num(value('orders.reserveTtlSeconds')),
    etaHours: num(value('delivery.etaHours')),
  };
  const { t, language } = await getAdminMessages();
  return <PageEditor key={page.slug} page={page} fills={fills} t={t} language={language} />;
}
