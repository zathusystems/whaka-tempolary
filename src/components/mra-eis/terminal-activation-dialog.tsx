'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Eye, EyeOff, Loader2, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import {
  DEFAULT_DEVICE_MAC_ADDRESS,
  ensureTauriDeviceIdentity,
  ensureTauriDeviceMacAddress,
  getDetectedOS,
  getDeviceMacAddress,
  getDeviceSerial,
  normalizeDeviceMacAddress,
} from '@/lib/device-identity';

const EIS_TERMINAL_ACTIVATION_CHANGED_EVENT = 'handypos-eis-terminal-activation-changed';
const ACTIVATION_RELOAD_DELAY_MS = 900;

const CONFIGURED_POS_NAME = (
  process.env.NEXT_PUBLIC_MRA_EIS_POS_NAME ||
  process.env.NEXT_PUBLIC_POS_NAME ||
  'Handy POS'
).trim();

const activationSchema = z.object({
  tac_code: z.string().min(1, 'Terminal Activation Code is required.'),
});

type ActivationFormValues = z.infer<typeof activationSchema>;

type TerminalActivationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: string | number | null;
  branchId?: string | number | null;
  reason?: string;
  onActivated?: (terminal: any) => void;
};

const resolveDeviceMacAddress = (): string => {
  return normalizeDeviceMacAddress(getDeviceMacAddress()) || DEFAULT_DEVICE_MAC_ADDRESS;
};

export function TerminalActivationDialog({
  open,
  onOpenChange,
  businessId,
  branchId,
  reason,
  onActivated,
}: TerminalActivationDialogProps) {
  const { toast } = useToast();
  const [showTac, setShowTac] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [deviceSerial, setDeviceSerial] = useState('');
  const [macAddress, setMacAddress] = useState(DEFAULT_DEVICE_MAC_ADDRESS);

  const form = useForm<ActivationFormValues>({
    resolver: zodResolver(activationSchema),
    defaultValues: { tac_code: '' },
  });

  const normalizedBusinessId = useMemo(() => String(businessId || '').trim(), [businessId]);
  const normalizedBranchId = useMemo(() => String(branchId || '').trim(), [branchId]);
  const canSubmit = Boolean(normalizedBusinessId && normalizedBranchId && deviceSerial);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadDeviceIdentity = async () => {
      const [resolvedSerial, resolvedMac] = await Promise.all([
        ensureTauriDeviceIdentity(),
        ensureTauriDeviceMacAddress(),
      ]);
      if (cancelled) return;
      setDeviceSerial(resolvedSerial || getDeviceSerial());
      setMacAddress(normalizeDeviceMacAddress(resolvedMac) || resolveDeviceMacAddress());
    };

    void loadDeviceIdentity();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const submitActivation = async (values: ActivationFormValues) => {
    if (!normalizedBusinessId || !normalizedBranchId) {
      toast({
        variant: 'destructive',
        title: 'Branch required',
        description: 'Select a branch first.',
      });
      return;
    }

    const resolvedSerial = deviceSerial || getDeviceSerial();
    if (!resolvedSerial) {
      toast({
        variant: 'destructive',
        title: 'Device identity unavailable',
        description: 'Restart the app.',
      });
      return;
    }

    const resolvedMacAddress = normalizeDeviceMacAddress(macAddress) || resolveDeviceMacAddress();
    setIsActivating(true);
    try {
      const response = await authFetch.fetch<any>(
        `/mra-eis/terminals/activate/?business_id=${normalizedBusinessId}&branch_id=${normalizedBranchId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            tac_code: values.tac_code,
            pos_name: CONFIGURED_POS_NAME,
            pos_version: '1.0.0',
            os_type: getDetectedOS(),
            device_serial: resolvedSerial,
            mac_address: resolvedMacAddress,
          }),
        }
      );

      const activationResult = response?.activation_result || response?.terminal?.activation_result || null;
      const terminalStatus = String(response?.status || response?.terminal?.status || '').toLowerCase();
      const activationWasDryRun = Boolean(activationResult?.dry_run);
      const activationError = activationResult?.error;
      const shouldReloadAfterActivation = terminalStatus === 'active' && !activationWasDryRun && !activationError;

      onActivated?.(response);
      window.dispatchEvent(new Event(EIS_TERMINAL_ACTIVATION_CHANGED_EVENT));
      form.reset({ tac_code: '' });
      onOpenChange(false);

      toast({
        title: activationWasDryRun
          ? 'Activation prepared only'
          : activationError
            ? 'Activation needs attention'
            : terminalStatus === 'active'
              ? 'Terminal activated'
              : 'Terminal registered',
        description: activationWasDryRun
          ? 'Activation prepared only.'
          : activationError
            ? 'Activation failed.'
            : terminalStatus === 'active'
              ? 'Reloading app.'
              : 'Activation submitted.',
      });

      if (shouldReloadAfterActivation && typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.location.reload();
        }, ACTIVATION_RELOAD_DELAY_MS);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Activation failed',
        description: 'Check the TAC.',
      });
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isActivating && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activate EIS Terminal</DialogTitle>
          <DialogDescription>
            Enter the MRA TAC.
          </DialogDescription>
        </DialogHeader>

        {reason && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            {reason}
          </div>
        )}

        <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="min-w-0">
            <p>Branch</p>
            <p className="break-all font-mono text-foreground">{normalizedBranchId || 'Not selected'}</p>
          </div>
          <div className="min-w-0">
            <p>Device serial</p>
            <p className="break-all font-mono text-foreground">{deviceSerial || 'Loading...'}</p>
          </div>
          <div className="min-w-0">
            <p>POS name</p>
            <p className="break-all font-medium text-foreground">{CONFIGURED_POS_NAME}</p>
          </div>
          <div className="min-w-0">
            <p>MAC address</p>
            <p className="break-all font-mono text-foreground">{macAddress || DEFAULT_DEVICE_MAC_ADDRESS}</p>
          </div>
        </div>

        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submitActivation)} className="space-y-4">
            <FormField
              control={form.control}
              name="tac_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terminal Activation Code</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        {...field}
                        autoFocus
                        type={showTac ? 'text' : 'password'}
                        placeholder="Enter TAC from MRA"
                      />
                    </FormControl>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowTac((value) => !value)}>
                      {showTac ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isActivating || !canSubmit}>
              {isActivating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Activate Terminal
                </>
              )}
            </Button>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
