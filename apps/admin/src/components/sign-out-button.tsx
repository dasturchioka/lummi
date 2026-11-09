'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      loading={pending}
      onClick={async () => {
        setPending(true);
        await browserApi.admin.logout();
        router.replace('/login');
        router.refresh();
      }}
    >
      <LogOut strokeWidth={1.5} aria-hidden />
    </Button>
  );
}
