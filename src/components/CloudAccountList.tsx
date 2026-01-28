import {
  useCloudAccounts,
  useRefreshQuota,
  useDeleteCloudAccount,
  useAddGoogleAccount,
  useSwitchCloudAccount,
  useAutoSwitchEnabled,
  useSetAutoSwitchEnabled,
  useForcePollCloudMonitor,
  startAuthFlow,
} from '@/hooks/useCloudAccounts';
import { CloudAccountCard } from '@/components/CloudAccountCard';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import {
  Plus,
  Loader2,
  Cloud,
  Zap,
  RefreshCcw,
  CheckSquare,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';

export function CloudAccountList() {
  const { t } = useTranslation();
  const { data: accounts, isLoading, isError } = useCloudAccounts();
  const refreshMutation = useRefreshQuota();
  const deleteMutation = useDeleteCloudAccount();
  const addMutation = useAddGoogleAccount();
  const switchMutation = useSwitchCloudAccount();

  const { data: autoSwitchEnabled, isLoading: isSettingsLoading } = useAutoSwitchEnabled();
  const setAutoSwitchMutation = useSetAutoSwitchEnabled();
  const forcePollMutation = useForcePollCloudMonitor();

  const { toast } = useToast();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [authCode, setAuthCode] = useState('');

  const handleAddAccount = useCallback((codeVal?: string) => {
    const codeToUse = codeVal || authCode;
    if (!codeToUse) return;
    addMutation.mutate({ authCode: codeToUse }, {
      onSuccess: () => {
        setIsAddDialogOpen(false);
        setAuthCode('');
        toast({ title: t('cloud.toast.addSuccess') });
      },
      onError: (err) => {
        toast({
          title: t('cloud.toast.addFailed.title'),
          description: getLocalizedErrorMessage(err, t),
          variant: 'destructive',
        });
      },
    });
  }, [authCode, addMutation, setIsAddDialogOpen, setAuthCode, toast, t]);

  useEffect(() => {
    if (window.electron?.onGoogleAuthCode) {
      const cleanup = window.electron.onGoogleAuthCode((code) => {
        setAuthCode(code);
      });
      return cleanup;
    }
  }, []);

  useEffect(() => {
    if (authCode && isAddDialogOpen && !addMutation.isPending) {
      handleAddAccount(authCode);
    }
  }, [authCode, isAddDialogOpen, addMutation.isPending, handleAddAccount]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleRefresh = (id: string) => {
    refreshMutation.mutate({ accountId: id }, {
      onSuccess: () => toast({ title: t('cloud.toast.quotaRefreshed') }),
      onError: () => toast({ title: t('cloud.toast.refreshFailed'), variant: 'destructive' }),
    });
  };

  const handleSwitch = (id: string) => {
    switchMutation.mutate({ accountId: id }, {
      onSuccess: () => toast({ title: t('cloud.toast.switched.title'), description: t('cloud.toast.switched.description') }),
      onError: (err) => toast({
        title: t('cloud.toast.switchFailed'),
        description: getLocalizedErrorMessage(err, t),
        variant: 'destructive',
      }),
    });
  };

  const handleDelete = (id: string) => {
    if (confirm(t('cloud.toast.deleteConfirm'))) {
      deleteMutation.mutate({ accountId: id }, {
        onSuccess: () => {
          toast({ title: t('cloud.toast.deleted') });
          setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        },
        onError: () => toast({ title: t('cloud.toast.deleteFailed'), variant: 'destructive' }),
      });
    }
  };

  const handleToggleAutoSwitch = (checked: boolean) => {
    setAutoSwitchMutation.mutate({ enabled: checked }, {
      onSuccess: () => toast({ title: checked ? t('cloud.toast.autoSwitchOn') : t('cloud.toast.autoSwitchOff') }),
      onError: () => toast({ title: t('cloud.toast.updateSettingsFailed'), variant: 'destructive' }),
    });
  };

  const handleForcePoll = () => {
    forcePollMutation.mutate(undefined, { onSuccess: () => toast({ title: t('cloud.polling') }) });
  };

  const openAuthUrl = async () => {
    try { await startAuthFlow(); } catch (e) {
      toast({ title: t('cloud.toast.startAuthFailed'), description: String(e), variant: 'destructive' });
    }
  };

  const toggleSelection = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === accounts?.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(accounts?.map((a) => a.id) || []));
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  if (isError) return <div className="p-4 text-red-500">Failed to load cloud accounts.</div>;

  return (
    <div className="relative space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex shrink-0 flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">{t('cloud.title')}</h2>
          <p className="text-muted-foreground">{t('cloud.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-muted/20 flex items-center gap-2 rounded-md border p-2">
            <Zap className={`h-4 w-4 ${autoSwitchEnabled ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'}`} />
            <Label htmlFor="auto-switch" className="cursor-pointer text-sm font-medium">{t('cloud.autoSwitch')}</Label>
            <Switch id="auto-switch" checked={!!autoSwitchEnabled} onCheckedChange={handleToggleAutoSwitch} disabled={isSettingsLoading || setAutoSwitchMutation.isPending} />
          </div>
          <Button variant="ghost" onClick={toggleSelectAll} title={t('cloud.batch.selectAll')}>
            <CheckSquare className={`mr-2 h-4 w-4 ${selectedIds.size > 0 && selectedIds.size === accounts?.length ? 'text-primary fill-primary/20' : ''}`} />
            {t('cloud.batch.selectAll')}
          </Button>
          <Button variant="outline" size="icon" onClick={handleForcePoll} disabled={forcePollMutation.isPending}>
            <RefreshCcw className={`h-4 w-4 ${forcePollMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />{t('cloud.addAccount')}</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader><DialogTitle>{t('cloud.authDialog.title')}</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <Button variant="outline" onClick={openAuthUrl}><Cloud className="mr-2 h-4 w-4" />{t('cloud.authDialog.openLogin')}</Button>
                <div className="space-y-2">
                  <Label htmlFor="code">{t('cloud.authDialog.authCode')}</Label>
                  <Input id="code" placeholder={t('cloud.authDialog.placeholder')} value={authCode} onChange={(e) => setAuthCode(e.target.value)} />
                </div>
              </div>
              <DialogFooter><Button onClick={() => handleAddAccount()} disabled={addMutation.isPending || !authCode}>{t('cloud.authDialog.verify')}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts?.map((account) => (
          <CloudAccountCard
            key={account.id}
            account={account}
            onRefresh={handleRefresh}
            onDelete={handleDelete}
            onSwitch={handleSwitch}
            isSelected={selectedIds.has(account.id)}
            onToggleSelection={toggleSelection}
            isSwitching={switchMutation.isPending && switchMutation.variables?.accountId === account.id}
          />
        ))}
      </div>
    </div>
  );
}
