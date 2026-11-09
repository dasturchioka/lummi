import { useRouter } from '@tanstack/react-router';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { BagIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { EmptyState } from '../ui/States';

/** Where «Оформить заказ» lands until the checkout ticket (#23) builds the real screen. */
export function Checkout() {
  const { t } = usePrefs();
  const router = useRouter();
  return (
    <Screen tabBar={false}>
      <EmptyState
        fill
        icon={<BagIcon size={28} />}
        title={t.cart.checkoutSoonTitle}
        text={t.cart.checkoutSoonText}
        action={
          <Button block onClick={() => router.history.back()}>
            {t.cart.title}
          </Button>
        }
      />
    </Screen>
  );
}
