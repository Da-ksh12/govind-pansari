import React, { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

export default function AdminLayout() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);

  useEffect(() => {
    // UX guard only — the real security boundary is server-side
    // (has_permission()/RLS on every admin RPC and table, section 44).
    // A non-admin landing here by a stale deep link just gets bounced
    // home rather than shown an empty/broken panel.
    if (status === 'authenticated' && profile && profile.role !== 'admin') {
      router.replace('/');
    }
  }, [status, profile]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
