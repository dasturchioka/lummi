import { NotFoundState } from '@/components/not-found-state';
import { getAdminMessages } from '@/lib/i18n';

/** `notFound()` from a panel screen (a missing order, say): the 404 inside the shell. */
export default async function PanelNotFound() {
  const { t } = await getAdminMessages();
  return <NotFoundState t={t} />;
}
