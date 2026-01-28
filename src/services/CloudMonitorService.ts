import { CloudAccountRepo } from '../ipc/database/cloudHandler';
import { GoogleAPIService } from './GoogleAPIService';
import { AutoSwitchService } from './AutoSwitchService';
import { logger } from '../utils/logger';
import { CloudAccount } from '../types/cloudAccount';
import { exponentialBackoff, Semaphore } from '../utils/resilience';

export class CloudMonitorService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static POLL_INTERVAL = 1000 * 60 * 5; // 5 minutes
  private static semaphore = new Semaphore(3); // PhD Level: Global concurrency limit

  static start() {
    if (this.intervalId) return;
    logger.info('Starting CloudMonitorService (Resilient Mode)...');

    // Initial Poll
    this.poll().catch((e) => logger.error('Initial poll failed', e));

    this.intervalId = setInterval(() => {
      this.poll().catch((e) => logger.error('Scheduled poll failed', e));
    }, this.POLL_INTERVAL);
  }

  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped CloudMonitorService');
    }
  }

  static async poll() {
    logger.info('CloudMonitor: Polling quotas with industrial resilience...');
    const accounts = await CloudAccountRepo.getAccounts();
    const now = Math.floor(Date.now() / 1000);

    // PhD Level: Parallel execution managed by Semaphore
    const tasks = accounts.map((account) =>
      this.semaphore.run(() => this.processAccount(account, now)),
    );

    await Promise.allSettled(tasks);

    // 4. Check for Auto-Switch
    await AutoSwitchService.checkAndSwitchIfNeeded();
  }

  private static async processAccount(account: CloudAccount, now: number) {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        // State Transition: REFRESHING
        await CloudAccountRepo.updateAccountStatus(account.id, 'refreshing');

        // 1. Check/Refresh Token if needed
        let accessToken = account.token.access_token;
        if (account.token.expiry_timestamp < now + 600) {
          logger.info(`Monitor: Refreshing token for ${account.email} (Attempt ${attempt + 1})`);
          const newToken = await GoogleAPIService.refreshAccessToken(account.token.refresh_token);
          account.token.access_token = newToken.access_token;
          account.token.expires_in = newToken.expires_in;
          account.token.expiry_timestamp = now + newToken.expires_in;
          await CloudAccountRepo.updateToken(account.id, account.token);
          accessToken = newToken.access_token;
        }

        // 2. Fetch Quota
        const quota = await GoogleAPIService.fetchQuota(accessToken);

        // 3. Update DB and Status: ACTIVE
        await CloudAccountRepo.updateQuota(account.id, quota);
        await CloudAccountRepo.updateAccountStatus(account.id, 'active');
        
        logger.info(`Monitor: Successfully updated ${account.email}`);
        return; // Success, exit retry loop

      } catch (error: unknown) {
        attempt++;
        const isRateLimit = (error as any).response?.status === 429 || (error as any).message?.includes('429');
        
        if (isRateLimit) {
          logger.warn(`Monitor: Rate limit detected for ${account.email}. Marking as rate_limited.`);
          await CloudAccountRepo.updateAccountStatus(account.id, 'rate_limited');
          return; // Don't retry on rate limit, wait for next poll
        }

        if (attempt >= MAX_RETRIES) {
          logger.error(`Monitor: Final failure for ${account.email} after ${MAX_RETRIES} attempts`, error);
          await CloudAccountRepo.updateAccountStatus(account.id, 'error');
        } else {
          // PhD Level: Exponential Backoff with Jitter
          logger.warn(`Monitor: Retry ${attempt}/${MAX_RETRIES} for ${account.email}`);
          await exponentialBackoff(attempt);
        }
      }
    }
  }
}

