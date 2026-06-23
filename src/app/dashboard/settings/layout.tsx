
'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';

const BUSINESS_SETTINGS_CHANGED_EVENT = 'handypos-business-settings-changed';

const readBooleanFlag = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'disabled'].includes(normalized)) return false;
  return null;
};

const parseStoredJson = (key: string): Record<string, any> | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const resolveEisEnabled = (business: any): boolean => {
  const storedBusiness =
    parseStoredJson('handy-pos-business') ??
    parseStoredJson('handypos-business') ??
    {};
  const storedSettings = parseStoredJson('handypos-business-settings') ?? {};
  const businessId = String(business?.id ?? storedBusiness?.id ?? '').trim();
  const settingsBusinessId = String(storedSettings?.businessId ?? storedSettings?.business_id ?? '').trim();
  const settingsBelongToBusiness = !settingsBusinessId || !businessId || settingsBusinessId === businessId;

  const candidates = [
    business?.enable_eis,
    business?.enableEis,
    business?.eis_enabled,
    business?.eisEnabled,
    storedBusiness?.enable_eis,
    storedBusiness?.enableEis,
    storedBusiness?.eis_enabled,
    storedBusiness?.eisEnabled,
    settingsBelongToBusiness ? storedSettings?.enableEis : undefined,
    settingsBelongToBusiness ? storedSettings?.enable_eis : undefined,
    settingsBelongToBusiness ? storedSettings?.eis_enabled : undefined,
    settingsBelongToBusiness ? storedSettings?.eisEnabled : undefined,
  ];

  for (const value of candidates) {
    const parsed = readBooleanFlag(value);
    if (parsed !== null) return parsed;
  }

  return false;
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { business } = useAuth();
  const [eisEnabled, setEisEnabled] = useState(false);

  // Determine the active tab from the URL path
  const activeTab = pathname.split('/').pop() || 'business';

  useEffect(() => {
    const refresh = () => setEisEnabled(resolveEisEnabled(business));
    refresh();

    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener(BUSINESS_SETTINGS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(BUSINESS_SETTINGS_CHANGED_EVENT, refresh);
    };
  }, [business]);

  useEffect(() => {
    if (eisEnabled && activeTab === 'taxes') {
      router.replace('/dashboard/settings/eis');
    }
  }, [activeTab, eisEnabled, router]);

  const onTabChange = (value: string) => {
    if (value === 'business') {
        router.push('/dashboard/settings');
    } else {
        router.push(`/dashboard/settings/${value}`);
    }
  };

  return (
    <div className="space-y-6">
       <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and business configurations.
        </p>
      </div>
      
      <Tabs defaultValue={activeTab} onValueChange={onTabChange} className="flex flex-col gap-6 md:flex-row">
        <TabsList className="flex h-full flex-col justify-start md:w-48">
          <TabsTrigger value="business" className="w-full justify-start">Business</TabsTrigger>
          {/* <TabsTrigger value="branches" className="w-full justify-start">Branches</TabsTrigger> */}
          {!eisEnabled && <TabsTrigger value="taxes" className="w-full justify-start">Taxes</TabsTrigger>}
          <TabsTrigger value="discounts" className="w-full justify-start">Discounts</TabsTrigger>
          <TabsTrigger value="eis" className="w-full justify-start">MRA EIS</TabsTrigger>
          <TabsTrigger value="printers" className="w-full justify-start">Printers</TabsTrigger>
        </TabsList>
        
        <div className="flex-1">
          {children}
        </div>
      </Tabs>
    </div>
  );
}
