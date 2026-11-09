'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await browserApi.admin.logout();
        router.replace('/login');
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
