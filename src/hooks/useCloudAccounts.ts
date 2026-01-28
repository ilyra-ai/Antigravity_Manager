import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listCloudAccounts,
  addGoogleAccount,
  deleteCloudAccount,
  refreshAccountQuota,
} from '@/actions/cloud';
import { CloudAccount } from '@/types/cloudAccount';

export const QUERY_KEYS = {
  cloudAccounts: ['cloudAccounts'],
};

export function useCloudAccounts() {
  return useQuery<CloudAccount[]>({
    queryKey: QUERY_KEYS.cloudAccounts,
    queryFn: listCloudAccounts,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useAddGoogleAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addGoogleAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
    },
  });
}

export function useDeleteCloudAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCloudAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
    },
  });
}

export function useRefreshQuota() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshAccountQuota,
    onSuccess: (updatedAccount: CloudAccount) => {
      // Optimistically update the list or just invalidate?
      // Invalidating is safer as sorting might change (last_used)
      queryClient.setQueryData(QUERY_KEYS.cloudAccounts, (oldData: CloudAccount[] | undefined) => {
        if (!oldData) return [updatedAccount];
        return oldData.map((acc) => (acc.id === updatedAccount.id ? updatedAccount : acc));
      });
    },
  });
}

import {
  switchCloudAccount,
  getAutoSwitchEnabled,
  setAutoSwitchEnabled,
  forcePollCloudMonitor,
} from '@/actions/cloud';

export function useSwitchCloudAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: switchCloudAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
      queryClient.invalidateQueries({ queryKey: ['currentAccount'] });
    },
  });
}

export const AUTO_SWITCH_KEY = ['autoSwitchEnabled'];

export function useAutoSwitchEnabled() {
  return useQuery<boolean>({
    queryKey: AUTO_SWITCH_KEY,
    queryFn: getAutoSwitchEnabled,
    staleTime: Infinity, // Settings don't change often unless we change them
  });
}

export function useSetAutoSwitchEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAutoSwitchEnabled,
    onSuccess: (_, variables) => {
      queryClient.setQueryData(AUTO_SWITCH_KEY, variables.enabled);
    },
  });
}

export function useForcePollCloudMonitor() {
  return useMutation({
    mutationFn: forcePollCloudMonitor,
  });
}

import { syncLocalAccount } from '@/actions/cloud';

export function useSyncLocalAccount() {
  const queryClient = useQueryClient();
  return useMutation<CloudAccount | null, Error, void>({
    mutationFn: syncLocalAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
    },
  });
}

import { startAuthFlow, syncLocalModels } from '@/actions/cloud';
export { startAuthFlow };

export function useSyncLocalModels() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, void>({
    mutationFn: syncLocalModels,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
    },
  });
}

import { updateSelectedModels } from '@/actions/cloud';

export function useUpdateSelectedModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSelectedModels,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
    },
  });
}
