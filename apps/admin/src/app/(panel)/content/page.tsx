import { redirect } from 'next/navigation';
import { BannerEditor } from '@/components/content/banner-editor';
import { PagesList } from '@/components/content/pages-list';
import { SloganEditor } from '@/components/content/slogan-editor';
import { PageHeader } from '@/components/page-header';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function ContentPage() {
  const api = await serverApi();
  const [banners, slogan, pages] = await Promise.all([
    api.content.banners.list(),
    api.content.slogan.get(),
    api.content.pages.list(),
  ]);
  if (banners.status === 401) redirect('/login');
  if (banners.status === 403) redirect('/'); // owner only
  if (banners.status !== 200 || slogan.status !== 200 || pages.status !== 200) {
    throw new Error('content failed to load');
  }
  const { t, language } = await getAdminMessages();
  return (
    <>
      <PageHeader title={t.content.title} description={t.content.description} />
      <div className="grid gap-4">
        <BannerEditor banners={banners.body} t={t} language={language} />
        <SloganEditor slogan={slogan.body.slogan ?? { ru: '', uz: '' }} t={t} />
        <PagesList pages={pages.body} t={t} language={language} />
      </div>
    </>
  );
}
