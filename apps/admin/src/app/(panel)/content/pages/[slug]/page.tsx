import { notFound, redirect } from 'next/navigation';
import { PageEditor } from '@/components/content/page-editor';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function EditInfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const api = await serverApi();
  const res = await api.content.pages.list();
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/');
  if (res.status !== 200) throw new Error('content failed to load');
  const page = res.body.find((p) => p.slug === slug);
  if (!page) notFound();
  const { t, language } = await getAdminMessages();
  return <PageEditor key={page.slug} page={page} t={t} language={language} />;
}
