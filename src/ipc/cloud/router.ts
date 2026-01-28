import { z } from 'zod';
import { os } from '@orpc/server';
import {
  addGoogleAccount,
  listCloudAccounts,
  deleteCloudAccount,
  refreshAccountQuota,
  switchCloudAccount,
  getAutoSwitchEnabled,
  setAutoSwitchEnabled,
  forcePollCloudMonitor,
  startAuthFlow,
} from './handler';
import { LocalModelDiscoveryService } from './local-discovery';
import { CloudAccountSchema } from '../../types/cloudAccount';
import { CloudAccountRepo } from '../database/cloudHandler';

export const cloudRouter = os.router({
  addGoogleAccount: os
    .input(z.object({ authCode: z.string() }))
    .output(CloudAccountSchema)
    .handler(async ({ input }: any) => {
      return addGoogleAccount(input.authCode);
    }),

  listCloudAccounts: os.output(z.array(CloudAccountSchema)).handler(async () => {
    return listCloudAccounts();
  }),

  deleteCloudAccount: os
    .input(z.object({ accountId: z.string() }))
    .output(z.void())
    .handler(async ({ input }: any) => {
      await deleteCloudAccount(input.accountId);
    }),

  refreshAccountQuota: os
    .input(z.object({ accountId: z.string() }))
    .output(CloudAccountSchema)
    .handler(async ({ input }: any) => {
      return refreshAccountQuota(input.accountId);
    }),

  switchCloudAccount: os
    .input(z.object({ accountId: z.string() }))
    .output(z.void())
    .handler(async ({ input }: any) => {
      await switchCloudAccount(input.accountId);
    }),

  getAutoSwitchEnabled: os.output(z.boolean()).handler(async () => {
    return getAutoSwitchEnabled();
  }),

  setAutoSwitchEnabled: os
    .input(z.object({ enabled: z.boolean() }))
    .output(z.void())
    .handler(async ({ input }: any) => {
      await setAutoSwitchEnabled(input.enabled);
    }),

  forcePollCloudMonitor: os.output(z.void()).handler(async () => {
    await forcePollCloudMonitor();
  }),

  startAuthFlow: os.output(z.void()).handler(async () => {
    await startAuthFlow();
  }),

  syncLocalAccount: os.output(CloudAccountSchema.nullable()).handler(async () => {
    try {
      const result = await CloudAccountRepo.syncFromIDE();

      return result;
    } catch (error: any) {
      console.error('[ORPC] syncLocalAccount error:', error.message, error.stack);
      throw error;
    }
  }),
  
  syncLocalModels: os.output(z.number()).handler(async () => {
    try {
      return await LocalModelDiscoveryService.syncLocalModels();
    } catch (error: any) {
      console.error('[ORPC] syncLocalModels error:', error.message);
      throw error;
    }
  }),

  updateSelectedModels: os
    .input(z.object({ accountId: z.string(), models: z.array(z.string()) }))
    .output(z.void())
    .handler(async ({ input }: any) => {
      try {
        await CloudAccountRepo.updateSelectedModels(input.accountId, input.models);
      } catch (error: any) {
        console.error('[ORPC] updateSelectedModels error:', error.message);
        throw error;
      }
    }),
});
