import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { v4 as uuidv4 } from 'uuid';
import { getCloudAccountsDbPath, getAntigravityDbPaths } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { CloudAccount } from '../../types/cloudAccount';
import { encrypt, decrypt } from '../../utils/security';
import { ProtobufUtils } from '../../utils/protobuf';
import { GoogleAPIService } from '../../services/GoogleAPIService';

/**
 * Ensures that the cloud database file and schema exist.
 * @param dbPath {string} The path to the database file.
 */
function ensureDatabaseInitialized(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create accounts table
    // Storing complex objects (token, quota) as JSON strings for simplicity
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        token_json TEXT NOT NULL,
        quota_json TEXT,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        is_active INTEGER DEFAULT 0
      );
    `);

    // Migration: Check if is_active column exists
    const tableInfo = db.pragma('table_info(accounts)') as any[];
    const hasIsActive = tableInfo.some((col) => col.name === 'is_active');
    if (!hasIsActive) {
      db.exec('ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 0');
    }

    const hasSelectedModels = tableInfo.some((col) => col.name === 'selected_models_json');
    if (!hasSelectedModels) {
      db.exec('ALTER TABLE accounts ADD COLUMN selected_models_json TEXT');
    }

    // Create index on email for faster lookups
    // Create index on email for faster lookups
    db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);`);

    // Create settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  } catch (error) {
    logger.error('Failed to initialize cloud database schema', error);
    throw error;
  } finally {
    if (db) db.close();
  }
}

/**
 * Gets a connection to the cloud accounts database.
 */
function getDb(): Database.Database {
  const dbPath = getCloudAccountsDbPath();
  ensureDatabaseInitialized(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

export class CloudAccountRepo {
  static async init(): Promise<void> {
    const dbPath = getCloudAccountsDbPath();
    ensureDatabaseInitialized(dbPath);
    await this.migrateToEncrypted();
  }

  static async migrateToEncrypted(): Promise<void> {
    const db = getDb();
    try {
      const rows = db.prepare('SELECT id, token_json, quota_json FROM accounts').all() as any[];

      for (const row of rows) {
        let changed = false;
        let newToken = row.token_json;
        let newQuota = row.quota_json;

        // Check if plain text (starts with {)
        if (newToken && newToken.startsWith('{')) {
          newToken = await encrypt(newToken);
          changed = true;
        }
        if (newQuota && newQuota.startsWith('{')) {
          newQuota = await encrypt(newQuota);
          changed = true;
        }

        if (changed) {
          db.prepare('UPDATE accounts SET token_json = ?, quota_json = ? WHERE id = ?').run(
            newToken,
            newQuota,
            row.id,
          );
          logger.info(`Migrated account ${row.id} to encrypted storage`);
        }
      }
    } catch (e) {
      logger.error('Failed to migrate data', e);
    } finally {
      db.close();
    }
  }

  static async addAccount(account: CloudAccount): Promise<void> {
    const db = getDb();

    try {
      const tokenEncrypted = await encrypt(JSON.stringify(account.token));
      const quotaEncrypted = account.quota ? await encrypt(JSON.stringify(account.quota)) : null;

      const transaction = db.transaction(() => {
        // If this account is being set to active, deactivate all others first
        if (account.is_active) {
          logger.info(
            `[DEBUG] addAccount: Deactivating all other accounts because ${account.email} is active`,
          );
          const info = db.prepare('UPDATE accounts SET is_active = 0').run();
          logger.info(`[DEBUG] addAccount: Deactivation changed ${info.changes} rows`);
        }

        const stmt = db.prepare(`
          INSERT OR REPLACE INTO accounts (
            id, provider, email, name, avatar_url, token_json, quota_json, created_at, last_used, status, is_active, selected_models_json
          ) VALUES (
            @id, @provider, @email, @name, @avatar_url, @token_json, @quota_json, @created_at, @last_used, @status, @is_active, @selected_models_json
          )
        `);

        stmt.run({
          id: account.id,
          provider: account.provider,
          email: account.email,
          name: account.name || null,
          avatar_url: account.avatar_url || null,
          token_json: tokenEncrypted,
          quota_json: quotaEncrypted,
          created_at: account.created_at,
          last_used: account.last_used,
          status: account.status || 'active',
          is_active: account.is_active ? 1 : 0,
          selected_models_json: account.selected_models ? JSON.stringify(account.selected_models) : null,
        });
      });

      transaction();
      logger.info(`Added/Updated cloud account: ${account.email}`);
    } finally {
      db.close();
    }
  }

  static async getAccounts(): Promise<CloudAccount[]> {
    const db = getDb();

    try {
      const stmt = db.prepare('SELECT * FROM accounts ORDER BY last_used DESC');
      const rows = stmt.all() as any[];

      // DEBUG LOGS
      const activeRows = rows.filter((r) => r.is_active);
      logger.info(
        `[DEBUG] getAccounts: Found ${rows.length} accounts, ${activeRows.length} active.`,
      );
      activeRows.forEach((r) => logger.info(`[DEBUG] Active Account: ${r.email} (${r.id})`));

      const accounts = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          provider: row.provider,
          email: row.email,
          name: row.name,
          avatar_url: row.avatar_url,
          token: JSON.parse(await decrypt(row.token_json)),
          quota: row.quota_json ? JSON.parse(await decrypt(row.quota_json)) : undefined,
          created_at: row.created_at,
          last_used: row.last_used,
          status: row.status,
          is_active: Boolean(row.is_active),
          selected_models: row.selected_models_json ? JSON.parse(row.selected_models_json) : undefined,
        })),
      );

      return accounts;
    } finally {
      db.close();
    }
  }

  static async getAccount(id: string): Promise<CloudAccount | undefined> {
    const db = getDb();

    try {
      const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?');
      const row = stmt.get(id) as any;

      if (!row) return undefined;

      return {
        id: row.id,
        provider: row.provider,
        email: row.email,
        name: row.name,
        avatar_url: row.avatar_url,
        token: JSON.parse(await decrypt(row.token_json)),
        quota: row.quota_json ? JSON.parse(await decrypt(row.quota_json)) : undefined,
        created_at: row.created_at,
        last_used: row.last_used,
        status: row.status,
        is_active: Boolean(row.is_active),
        selected_models: row.selected_models_json ? JSON.parse(row.selected_models_json) : undefined,
      };
    } finally {
      db.close();
    }
  }

  static async removeAccount(id: string): Promise<void> {
    const db = getDb();
    try {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      logger.info(`Removed cloud account: ${id}`);
    } finally {
      db.close();
    }
  }

  static async updateToken(id: string, token: any): Promise<void> {
    const db = getDb();

    try {
      const encrypted = await encrypt(JSON.stringify(token));
      db.prepare('UPDATE accounts SET token_json = ? WHERE id = ?').run(encrypted, id);
    } finally {
      db.close();
    }
  }

  static async updateQuota(id: string, quota: any): Promise<void> {
    const db = getDb();

    try {
      const encrypted = await encrypt(JSON.stringify(quota));
      db.prepare('UPDATE accounts SET quota_json = ? WHERE id = ?').run(encrypted, id);
    } finally {
      db.close();
    }
  }

  static async updateSelectedModels(id: string, models: string[]): Promise<void> {
    const db = getDb();
    try {
      const json = JSON.stringify(models);
      db.prepare('UPDATE accounts SET selected_models_json = ? WHERE id = ?').run(json, id);
      logger.info(`Updated selected models for account ${id}`);
    } finally {
      db.close();
    }
  }

  static updateLastUsed(id: string): void {
    const db = getDb();
    try {
      db.prepare('UPDATE accounts SET last_used = ? WHERE id = ?').run(
        Math.floor(Date.now() / 1000),
        id,
      );
    } finally {
      db.close();
    }
  }

  static setActive(id: string): void {
    const db = getDb();
    const updateAll = db.prepare('UPDATE accounts SET is_active = 0');
    const updateOne = db.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?');

    const transaction = db.transaction(() => {
      updateAll.run();
      updateOne.run(id);
    });

    try {
      transaction();
      logger.info(`Set account ${id} as active`);
    } finally {
      db.close();
    }
  }

  static injectCloudToken(account: CloudAccount): void {
    const dbPaths = getAntigravityDbPaths();
    let dbPath: string | null = null;

    for (const p of dbPaths) {
      if (fs.existsSync(p)) {
        dbPath = p;
        break;
      }
    }

    if (!dbPath) {
      throw new Error(`Antigravity database not found. Checked paths: ${dbPaths.join(', ')}`);
    }

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      const row = db
        .prepare('SELECT value FROM ItemTable WHERE key = ?')
        .get('jetskiStateSync.agentManagerInitState') as { value: string } | undefined;

      if (!row || !row.value) {
        logger.warn(
          'jetskiStateSync.agentManagerInitState not found. ' +
            'Injecting minimal auth state only. User may need to complete onboarding in the IDE first.',
        );

        // Create a minimal Protobuf structure for the token
        const sovereignToken = account.provider.startsWith('local-') 
          ? `ya29.SovereignHardware-${account.id}-${Date.now().toString(16)}` 
          : account.token.access_token;

        const minimalTokenInfo = ProtobufUtils.createOAuthTokenInfo(
          sovereignToken,
          account.token.refresh_token,
          account.token.expiry_timestamp,
        );

        const minimalB64 = Buffer.from(minimalTokenInfo).toString('base64');

        db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run(
          'jetskiStateSync.agentManagerInitState',
          minimalB64,
        );

        db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run(
          'antigravityOnboarding',
          'true',
        );

        db.prepare('DELETE FROM ItemTable WHERE key = ?').run('google.antigravity');

        logger.info(
          `Injected minimal auth state for ${account.email} (no protobuf state available)`,
        );

        return; // Early return - skip protobuf manipulation
      }

      // 1. Decode Base64
      const buffer = Buffer.from(row.value, 'base64');
      const data = new Uint8Array(buffer);

      // 2. Remove Field 6
      const cleanData = ProtobufUtils.removeField(data, 6);

      // 3. Create New Field 6 (Industrial Sovereignty Identity)
      const isLocal = account.provider.startsWith('local-');
      // ya29 prefix is essential to mimic Google OAuth tokens and satisfy IDE parsers
      const sovereignToken = isLocal 
        ? `ya29.SovereignHardware-${account.id}-${Date.now().toString(16)}` 
        : account.token.access_token;

      const newField = ProtobufUtils.createOAuthTokenInfo(
        sovereignToken,
        account.token.refresh_token,
        account.token.expiry_timestamp,
      );

      // 4. Concatenate
      const finalData = new Uint8Array(cleanData.length + newField.length);
      finalData.set(cleanData, 0);
      finalData.set(newField, cleanData.length);

      // 5. Encode Base64
      const finalB64 = Buffer.from(finalData).toString('base64');

      // 6. Write back
      db.prepare('UPDATE ItemTable SET value = ? WHERE key = ?').run(
        finalB64,
        'jetskiStateSync.agentManagerInitState',
      );

      // 7. Inject Onboarding Flag
      db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run(
        'antigravityOnboarding',
        'true',
      );

      // 8. Update Auth Status (Fix for switching issue)
      const authStatus = {
        name: isLocal ? `LOCAL: ${account.token.project_id || 'HARDWARE'}` : (account.name || account.email),
        email: account.email,
        apiKey: sovereignToken, 
      };

      db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run(
        'antigravityAuthStatus',
        JSON.stringify(authStatus),
      );

      // 9. PhD Level: Multi-Key Redirection & Session Cleanup

      // 10. PhD Level: Proxy Endpoint Sovereignty
      // We MUST redirect the IDE's traffic to our local Proxy server (NestJS) running on port 8045.
      // We use a SAFE MERGE to avoid corrupting other user settings.
      const proxyUrl = 'http://localhost:8045';
      const userSettingsKey = 'antigravityUserSettings.allUserSettings';
      const settingsRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(userSettingsKey) as { value: string } | undefined;
      
      let settings: Record<string, any> = {};
      if (settingsRow && settingsRow.value) {
        try {
          settings = JSON.parse(settingsRow.value);
        } catch (e) {
          logger.warn('Failed to parse existing allUserSettings, starting with empty object');
        }
      }
      
      // We inject/override only what is necessary for sovereignty
      // Overriding both google and cloudcode keys for maximum compatibility with all IDE versions
      settings['google.baseUrl'] = proxyUrl;
      settings['google.location'] = 'us-central1'; 
      settings['cloudcode.baseUrl'] = proxyUrl;
      settings['cloudcode.location'] = 'us-central1';
      settings['antigravity.baseUrl'] = proxyUrl;
      
      db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run(
        userSettingsKey,
        JSON.stringify(settings)
      );

      // 11. PhD Level: Cleanup Corrupted Sessions (auth-tokens)
      // Solução para o erro persistente "Unexpected issue setting up your account".
      // Implementamos um mecanismo de RETRY robusto para lidar com bloqueios de arquivo no Windows (EBUSY).
      try {
        const appData = path.dirname(path.dirname(path.dirname(dbPath)));
        const authTokensPath = path.join(appData, 'auth-tokens');
        
        if (fs.existsSync(authTokensPath)) {
          logger.info(`Cleaning up corrupted session data at ${authTokensPath} (com retry)`);
          
          const maxRetries = 5;
          let attempt = 0;
          let deleted = false;

          while (attempt < maxRetries && !deleted) {
            try {
              // Pequeno delay inicial e entre tentativas para dar tempo ao SO liberar o arquivo
              // O delay aumenta exponencialmente: 500ms, 1000ms, 2000ms...
              if (attempt > 0) {
                 const delay = 500 * Math.pow(2, attempt - 1);
                 // Função sleep síncrona improvisada para este contexto crítico
                 const start = Date.now();
                 while (Date.now() - start < delay) {} 
              }

              fs.rmSync(authTokensPath, { recursive: true, force: true });
              deleted = true;
              logger.info('Sucesso ao limpar auth-tokens.');
            } catch (err: any) {
              attempt++;
              logger.warn(`Tentativa ${attempt}/${maxRetries} de limpar auth-tokens falhou: ${err.message}`);
              
              if (attempt === maxRetries) {
                logger.error('Falha crítica: Não foi possível limpar auth-tokens após várias tentativas. O Windows pode estar bloqueando o arquivo.', err);
                // Não lançamos o erro para não quebrar todo o fluxo, mas o usuário pode ver comportamento instável
              }
            }
          }
        }
      } catch (e) {
         logger.warn('Failed to cleanup auth-tokens (IDE might be running or permission issue)', e);
      }

      logger.info(
        `Successfully injected ${isLocal ? 'SOVEREIGN' : 'CLOUD'} identity and PROXY ENDPOINT for ${account.email} into Antigravity database.`,
      );
    } catch (e) {
      logger.error(`Critical failure during identity injection for ${account.email}`, e);
      throw e;
    } finally {
      db.close();
    }
  }

  static getSetting<T>(key: string, defaultValue: T): T {
    const db = getDb();
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      if (!row) return defaultValue;
      return JSON.parse(row.value) as T;
    } catch (e) {
      logger.error(`Failed to get setting ${key}`, e);
      return defaultValue;
    } finally {
      db.close();
    }
  }

  static setSetting(key: string, value: any): void {
    const db = getDb();
    try {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        key,
        JSON.stringify(value),
      );
    } finally {
      db.close();
    }
  }

  static async syncFromIDE(): Promise<CloudAccount | null> {
    // Try all possible database paths
    const dbPaths = getAntigravityDbPaths();
    logger.info(`SyncLocal: Checking database paths: ${JSON.stringify(dbPaths)}`);

    let dbPath: string | null = null;
    for (const p of dbPaths) {
      logger.info(`SyncLocal: Checking path: ${p}, exists: ${fs.existsSync(p)}`);
      if (fs.existsSync(p)) {
        dbPath = p;
        break;
      }
    }

    if (!dbPath) {
      const errorMsg = `Antigravity database not found. Please ensure Antigravity IDE is installed. Checked paths: ${dbPaths.join(', ')}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    logger.info(`SyncLocal: Using Antigravity database at: ${dbPath}`);
    const ideDb = new Database(dbPath, { readonly: true });
    ideDb.pragma('journal_mode = WAL');
    try {
      // 1. Read Raw Token Data
      const row = ideDb
        .prepare('SELECT value FROM ItemTable WHERE key = ?')
        .get('jetskiStateSync.agentManagerInitState') as { value: string } | undefined;

      if (!row || !row.value) {
        const errorMsg =
          'No cloud account found in IDE. Please login to a Google account in Antigravity IDE first.';
        logger.warn(`SyncLocal: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 2. Decode Protobuf
      const buffer = Buffer.from(row.value, 'base64');
      const data = new Uint8Array(buffer);
      const tokenInfo = ProtobufUtils.extractOAuthTokenInfo(data);

      if (!tokenInfo) {
        const errorMsg =
          'No OAuth token found in IDE state. Please login to a Google account in Antigravity IDE first.';
        logger.warn(`SyncLocal: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 3. Fetch User Info
      // We need to fetch user info to know who this token belongs to
      let userInfo;
      try {
        userInfo = await GoogleAPIService.getUserInfo(tokenInfo.accessToken);
      } catch (apiError: any) {
        const errorMsg = `Failed to validate token with Google API. The token may be expired. Please re-login in Antigravity IDE. Error: ${apiError.message}`;
        logger.error(`SyncLocal: ${errorMsg}`, apiError);
        throw new Error(errorMsg);
      }

      // 4. Check Duplicate & Construct Account
      // We use existing addAccount logic which does UPSERT (REPLACE)
      // Construct CloudAccount object
      const now = Math.floor(Date.now() / 1000);
      const account: CloudAccount = {
        id: uuidv4(), // Generate new ID if new, but check existing email
        provider: 'google',
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture,
        token: {
          access_token: tokenInfo.accessToken,
          refresh_token: tokenInfo.refreshToken,
          expires_in: 3600, // Unknown, assume 1 hour validity or let it refresh
          expiry_timestamp: now + 3600,
          token_type: 'Bearer',
          email: userInfo.email,
        },
        created_at: now,
        last_used: now,
        status: 'active',
        is_active: true, // It is the active one in IDE
      };

      // Check if email already exists to preserve ID
      const accounts = await this.getAccounts();
      const existing = accounts.find((a) => a.email === account.email);
      if (existing) {
        account.id = existing.id; // Keep existing ID
        account.created_at = existing.created_at;
      }

      await this.addAccount(account);
      return account;
    } catch (error) {
      logger.error('SyncLocal: Failed to sync account from IDE', error);
      throw error;
    } finally {
      ideDb.close();
    }
  }
}
