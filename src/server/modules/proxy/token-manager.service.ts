import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CloudAccountRepo } from '../../../ipc/database/cloudHandler';
import { CloudAccount } from '../../../types/cloudAccount';
import { GoogleAPIService } from '../../../services/GoogleAPIService';

interface TokenData {
  email: string;
  account_id: string;
  provider: string; // New field
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expiry_timestamp: number;
  project_id?: string;
  session_id?: string;
  selected_models?: string[];
}

@Injectable()
export class TokenManagerService implements OnModuleInit {
  private readonly logger = new Logger(TokenManagerService.name);
  private currentIndex = 0;
  // In-memory cache of tokens with additional data
  private tokens: Map<string, TokenData> = new Map();
  // Cooldown map for rate-limited accounts
  private cooldowns: Map<string, number> = new Map();

  async onModuleInit() {
    // Load accounts on module initialization
    await this.loadAccounts();
  }

  async loadAccounts(): Promise<number> {
    try {
      const accounts = await CloudAccountRepo.getAccounts();
      let count = 0;

      for (const account of accounts) {
        const tokenData = this.convertAccountToToken(account);
        if (tokenData) {
          this.tokens.set(account.id, tokenData);
          count++;
        }
      }

      this.logger.log(`Loaded ${count} accounts`);
      return count;
    } catch (e) {
      this.logger.error('Failed to load accounts', e);
      return 0;
    }
  }

  private convertAccountToToken(account: CloudAccount): TokenData | null {
    if (!account.token) return null;

    return {
      account_id: account.id,
      email: account.email,
      provider: account.provider,
      access_token: account.token.access_token,
      refresh_token: account.token.refresh_token,
      expires_in: account.token.expires_in,
      expiry_timestamp: account.token.expiry_timestamp,
      project_id: account.token.project_id || undefined,
      session_id: account.token.session_id || this.generateSessionId(),
      selected_models: account.selected_models,
    };
  }

  private generateSessionId(): string {
    const min = 1_000_000_000_000_000_000n;
    const max = 9_000_000_000_000_000_000n;
    const range = max - min;
    const rand = BigInt(Math.floor(Math.random() * Number(range)));
    return (-(min + rand)).toString();
  }

  async getNextToken(requestedModel?: string): Promise<CloudAccount | null> {
    try {
      // Reload if empty
      if (this.tokens.size === 0) {
        await this.loadAccounts();
      }
      if (this.tokens.size === 0) return null;

      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);

      // Filter out accounts in cooldown AND those that don't satisfy model selection (if requested)
      const validTokens = Array.from(this.tokens.entries()).filter(([accountId, data]) => {
        const cooldownUntil = this.cooldowns.get(data.email);
        const isNotCooldown = !cooldownUntil || cooldownUntil <= now;
        
        // PhD Level: Selective Model Routing Logic
        // If the user has selected specific models for this account, we MUST respect it.
        // If requestedModel is null (e.g. status check), we skip this filter.
        let isModelAllowed = true;
        if (requestedModel && data.selected_models && data.selected_models.length > 0) {
            const cleanRequested = requestedModel.replace(/^models\//, '').toLowerCase();
            isModelAllowed = data.selected_models.some((sm: string) => 
                sm.replace(/^models\//, '').toLowerCase() === cleanRequested
            );
        }

        return isNotCooldown && isModelAllowed;
      });

      if (validTokens.length === 0) {
        this.logger.warn('All accounts are in cooldown');
        return null;
      }

      // Selection Logic (PhD Level: Priority to Active Local Account)
      const accountsInDb = await CloudAccountRepo.getAccounts();
      const activeAccount = accountsInDb.find(a => a.is_active);
      
      let accountId: string;
      let tokenData: TokenData;

      if (activeAccount && activeAccount.provider.startsWith('local-')) {
          // If a local model is active, LOCK session to it (High Fidelity Sovereignty)
          const localToken = this.tokens.get(activeAccount.id);
          if (localToken) {
              accountId = activeAccount.id;
              tokenData = localToken;
              this.logger.log(`Session LOCK: Active Local Model [${tokenData.email}] takes precedence.`);
          } else {
              [accountId, tokenData] = validTokens[this.currentIndex % validTokens.length];
              this.currentIndex++;
          }
      } else {
          // Standard Round Robin for cloud accounts
          [accountId, tokenData] = validTokens[this.currentIndex % validTokens.length];
          this.currentIndex++;
      }

      // Check if token needs refresh (expires in < 5 minutes)
      if (nowSeconds >= tokenData.expiry_timestamp - 300) {
        this.logger.log(`Token for ${tokenData.email} expiring soon, refreshing...`);
        try {
          const newTokens = await GoogleAPIService.refreshAccessToken(tokenData.refresh_token);

          // Update token data
          tokenData.access_token = newTokens.access_token;
          tokenData.expires_in = newTokens.expires_in;
          tokenData.expiry_timestamp = nowSeconds + newTokens.expires_in;

          // Save to DB
          await this.saveRefreshedToken(accountId, tokenData);
          this.tokens.set(accountId, tokenData);

          this.logger.log(`Token refreshed for ${tokenData.email}`);
        } catch (e) {
          this.logger.error(`Failed to refresh token for ${tokenData.email}`, e);
        }
      }

      // Resolve project ID if missing (Discovery Real PhD Level)
      if (!tokenData.project_id && (tokenData.provider === 'google' || tokenData.provider === 'anthropic')) {
        this.logger.log(`Project ID missing for ${tokenData.email}, initiating discovery...`);
        try {
            const realId = await GoogleAPIService.fetchProjectId(tokenData.access_token);
            if (realId) {
                tokenData.project_id = realId;
                await this.saveProjectId(accountId, realId);
            } else {
                // Persistent Fallback if discovery fails (Safe but marked)
                tokenData.project_id = `cloud-code-${tokenData.email.split('@')[0]}`;
            }
        } catch (e) {
            this.logger.warn(`Failed real discovery for ${tokenData.email}, using identifier-based ID`);
            tokenData.project_id = `cloud-code-${tokenData.email.split('@')[0]}`;
        }
      }

      this.logger.log(`Selected account: ${tokenData.email}`);

      // Return in CloudAccount format for compatibility
      return {
        id: accountId,
        email: tokenData.email,
        provider: tokenData.provider,
        token: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          expiry_timestamp: tokenData.expiry_timestamp,
          project_id: tokenData.project_id,
          session_id: tokenData.session_id,
        },
      } as CloudAccount;
    } catch (error) {
      this.logger.error('Failed to get token', error);
      return null;
    }
  }

  markAsRateLimited(email: string) {
    // Cooldown for 5 minutes
    const until = Date.now() + 5 * 60 * 1000;
    this.cooldowns.set(email, until);
    this.logger.warn(
      `Account ${email} marked as rate limited until ${new Date(until).toISOString()}`,
    );
  }

  resetCooldown(email: string) {
    this.cooldowns.delete(email);
  }

  private async saveRefreshedToken(accountId: string, tokenData: TokenData) {
    try {
      const acc = await CloudAccountRepo.getAccount(accountId);
      if (acc && acc.token) {
        const newToken = {
          ...acc.token,
          access_token: tokenData.access_token,
          expires_in: tokenData.expires_in,
          expiry_timestamp: tokenData.expiry_timestamp,
        };
        await CloudAccountRepo.updateToken(accountId, newToken);
      }
    } catch (e) {
      this.logger.error('Failed to save refreshed token to DB', e);
    }
  }

  private async saveProjectId(accountId: string, projectId: string) {
    try {
      const acc = await CloudAccountRepo.getAccount(accountId);
      if (acc && acc.token) {
        const newToken = {
          ...acc.token,
          project_id: projectId,
        };
        await CloudAccountRepo.updateToken(accountId, newToken);
      }
    } catch (e) {
      this.logger.error('Failed to save project ID to DB', e);
    }
  }

  /**
   * Get the number of loaded accounts (for status)
   */
  getAccountCount(): number {
    return this.tokens.size;
  }
}
