import { CloudAccountRepo } from '../ipc/database/cloudHandler';
import { CloudAccount } from '../types/cloudAccount';
import { switchCloudAccount } from '../ipc/cloud/handler';
import { logger } from '../utils/logger';
import { Notification } from 'electron';

export class AutoSwitchService {
  private static HYSTERESIS_THRESHOLD = 5; // 5% guard zone

  /**
   * PhD Level: Health Score Heuristic
   * Calculates a score from 0 to 100 based on:
   * - Quota availability (60%)
   * - Status stability (40%)
   * Latency and Error history can be added as we track them.
   */
  private static calculateHealthScore(account: CloudAccount): number {
    if (!account.quota) return 0;
    if (account.status === 'rate_limited' || account.status === 'error') return 0;

    const models = Object.values(account.quota.models);
    if (models.length === 0) return 0;

    const avgQuota = models.reduce((acc, m) => acc + m.percentage, 0) / models.length;
    
    // Base Score from Quota (0-60 points)
    let score = (avgQuota / 100) * 60;

    // Reliability Bonus (0-40 points)
    if (account.status === 'active') score += 40;
    if (account.status === 'refreshing') score += 20;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Finds the best cloud account to switch to.
   */
  static async findBestAccount(currentAccountId: string, currentScore: number): Promise<CloudAccount | null> {
    const accounts = await CloudAccountRepo.getAccounts();

    const candidates = accounts
      .filter((acc) => acc.id !== currentAccountId && acc.status === 'active')
      .map((acc) => ({
        account: acc,
        score: this.calculateHealthScore(acc),
      }))
      .filter((c) => c.score > currentScore + this.HYSTERESIS_THRESHOLD) // PhD Level: Hysteresis
      .sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0].account : null;
  }

  /**
   * Triggered by Monitor Service or UI.
   */
  static async checkAndSwitchIfNeeded(): Promise<boolean> {
    const enabled = CloudAccountRepo.getSetting<boolean>('auto_switch_enabled', false);
    if (!enabled) return false;

    const accounts = await CloudAccountRepo.getAccounts();
    const currentAccount = accounts.find((a) => a.is_active);

    if (!currentAccount) return false;

    const currentScore = this.calculateHealthScore(currentAccount);
    const isCritical = currentScore < 10 || currentAccount.status === 'rate_limited' || currentAccount.status === 'error';

    if (isCritical) {
      logger.info(`AutoSwitch: Current account ${currentAccount.email} health is critical (${Math.round(currentScore)}%). Searching for replacement...`);

      const nextAccount = await this.findBestAccount(currentAccount.id, currentScore);
      if (nextAccount) {
        const nextScore = this.calculateHealthScore(nextAccount);
        logger.info(`AutoSwitch: Switching to ${nextAccount.email} (Score: ${Math.round(nextScore)}%)`);

        await switchCloudAccount(nextAccount.id);

        // PhD Level: Contextual System Notification
        this.notifySwitch(currentAccount, nextAccount, currentScore);

        return true;
      } else {
        logger.warn('AutoSwitch: No healthy accounts available to switch to.');
      }
    }

    return false;
  }

  private static notifySwitch(oldAcc: CloudAccount, newAcc: CloudAccount, oldScore: number) {
    try {
      const reason = oldAcc.status === 'rate_limited' ? 'Rate Limit detectado' : `Saúde baixa (${Math.round(oldScore)}%)`;
      
      new Notification({
        title: 'Antigravity: Chaveamento Automático',
        body: `Origem: ${oldAcc.email}\nDestino: ${newAcc.email}\nMotivo: ${reason}`,
        silent: false,
      }).show();
    } catch (e) {
      logger.error('Failed to show system notification', e);
    }
  }

  static isAccountDepleted(account: CloudAccount): boolean {
    if (!account.quota) return false;
    const THRESHOLD = 5;
    return Object.values(account.quota.models).some((m) => m.percentage < THRESHOLD);
  }
}

