import { Card } from '@/components/ui/card';
import { getAdminMessages } from '@/lib/i18n';

export default async function HomePage() {
  const { t } = await getAdminMessages();
  return (
    <>
      <h1 className="title mb-6">{t.home.title}</h1>
      <Card className="p-8 text-muted-foreground">{t.home.empty}</Card>
    </>
  );
}
