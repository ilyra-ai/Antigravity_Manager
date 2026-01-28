import path from 'path';
import fs from 'fs';
import { AppConfig, AppConfigSchema, DEFAULT_APP_CONFIG } from '../../types/config';
import { getAppDataDir } from '../../utils/paths';
import { logger } from '../../utils/logger';

const CONFIG_FILENAME = 'gui_config.json';

export class ConfigManager {
  private static getConfigPath(): string {
    const appDataDir = getAppDataDir();
    if (!fs.existsSync(appDataDir)) {
      fs.mkdirSync(appDataDir, { recursive: true });
    }
    return path.join(appDataDir, CONFIG_FILENAME);
  }

  static loadConfig(): AppConfig {
    try {
      const configPath = this.getConfigPath();
      if (!fs.existsSync(configPath)) {
        logger.info(`Config: File not found at ${configPath}, returning default`);
        return DEFAULT_APP_CONFIG;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const raw = JSON.parse(content);

      // Merge with default to ensure new fields are present
      // Zod parse helps validate
      const merged = {
        ...DEFAULT_APP_CONFIG,
        ...raw,
        proxy: { ...DEFAULT_APP_CONFIG.proxy, ...(raw.proxy || {}) },
        local_ai: { ...DEFAULT_APP_CONFIG.local_ai, ...(raw.local_ai || {}) }
      };

      // Fix deep merge for upstream_proxy if needed
      if (raw.proxy && raw.proxy.upstream_proxy) {
        merged.proxy.upstream_proxy = {
          ...DEFAULT_APP_CONFIG.proxy.upstream_proxy,
          ...raw.proxy.upstream_proxy,
        };
      }

      // Handle Anthropic Mapping Map vs Object
      // In JSON it's object

      return merged as AppConfig;
    } catch (e) {
      logger.error('Config: Failed to load config', e);
      return DEFAULT_APP_CONFIG;
    }
  }

  static saveConfig(config: AppConfig): void {
    try {
      const configPath = this.getConfigPath();
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(configPath, content, 'utf-8');
      logger.info(`Config: Saved to ${configPath}`);
    } catch (e) {
      logger.error('Config: Failed to save config', e);
      throw e;
    }
  }
}
