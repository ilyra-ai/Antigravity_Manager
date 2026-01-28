import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { LocalAIClient, LocalAIConfig } from '../../server/modules/proxy/clients/local-ai.client';
import { ConfigManager } from '../config/manager';
import { CloudAccountRepo } from '../database/cloudHandler';
import { CloudAccount } from '../../types/cloudAccount';
import { logger } from '../../utils/logger';

export class LocalModelDiscoveryService {
  private static localClient = new LocalAIClient();

  /**
   * Scans for local instances and syncs them as cloud accounts.
   * PhD Level: Automatic resource mapping and de-duplication.
   */
  static async syncLocalModels(): Promise<number> {
    const appConfig = ConfigManager.loadConfig();
    const configs: LocalAIConfig[] = [];
    
    if (appConfig.local_ai?.ollama?.enabled) {
        configs.push({ provider: 'ollama', baseUrl: appConfig.local_ai.ollama.url });
    }
    if (appConfig.local_ai?.lmstudio?.enabled) {
        configs.push({ provider: 'lmstudio', baseUrl: appConfig.local_ai.lmstudio.url });
    }

    let totalSynced = 0;

    for (const config of configs) {
      try {
        let models: string[] = [];
        
        if (config.provider === 'ollama') {
          // Try native Ollama API first for higher fidelity
          try {
            const nativeUrl = config.baseUrl.replace('/v1', '/api/tags');
            const resp = await axios.get(nativeUrl, { timeout: 2000 });
            if (resp.data?.models) {
              models = resp.data.models.map((m: any) => m.name);
            }
          } catch (e) {
            // Fallback to OpenAI compatible endpoint
            models = await this.localClient.getModels(config);
          }
        } else {
          // LM Studio uses standard /v1/models
          models = await this.localClient.getModels(config);
        }

        for (const modelId of models) {
          const accountId = `local-${config.provider}-${modelId}`;
          const success = await this.registerLocalModel(accountId, modelId, config);
          if (success) totalSynced++;
        }
      } catch (e) {
        logger.warn(`[LocalDiscovery] Instance ${config.provider} not reachable at ${config.baseUrl}`);
      }
    }

    return totalSynced;
  }

  private static async registerLocalModel(id: string, modelName: string, config: LocalAIConfig): Promise<boolean> {
    const existing = await CloudAccountRepo.getAccount(id);
    if (existing) return false;

    const now = Math.floor(Date.now() / 1000);
    const account: CloudAccount = {
      id: id,
      provider: `local-${config.provider}` as any,
      email: `${modelName}@localhost`,
      name: `${config.provider.toUpperCase()}: ${modelName}`,
      avatar_url: null,
      token: {
        access_token: 'local-access', // Mock but required by schema
        refresh_token: config.baseUrl, // We hijack refresh_token to store base_url
        expires_in: 999999,
        expiry_timestamp: now + 999999,
        token_type: 'Bearer',
        project_id: modelName // Store model name here
      },
      created_at: now,
      last_used: now,
      status: 'active'
    };

    await CloudAccountRepo.addAccount(account);
    logger.info(`[LocalDiscovery] Registered ${config.provider} model: ${modelName}`);
    return true;
  }
}
