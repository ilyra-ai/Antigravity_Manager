import { ConfigManager } from '../ipc/config/manager';
import { ProxyAgent } from 'undici';

// --- Constants & Config ---

const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';

const URLS = {
  TOKEN: 'https://oauth2.googleapis.com/token',
  USER_INFO: 'https://www.googleapis.com/oauth2/v2/userinfo',
  AUTH: 'https://accounts.google.com/o/oauth2/v2/auth',
  QUOTA: 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  LOAD_PROJECT: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  EMBEDDING: 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent',
  LIST_MODELS_V1BETA: 'https://generativelanguage.googleapis.com/v1beta/models',
  LIST_MODELS_V1: 'https://generativelanguage.googleapis.com/v1/models',
};

// Internal API masquerading
const USER_AGENT = 'antigravity/1.11.3 Darwin/arm64';
const REDIRECT_URI = 'http://localhost:8888/oauth-callback';

// Request timeout in milliseconds (30 seconds)
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Creates an AbortSignal that times out after the specified duration.
 */
function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// --- Types ---

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  scope?: string;
}

export interface UserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
}

export interface QuotaData {
  models: Record<
    string,
    {
      percentage: number;
      resetTime: string;
      displayName?: string;
      maxTokenAllowed?: number;
      maxCompletionTokens?: number;
    }
  >;
}

// Internal types for API parsing
interface ModelInfoRaw {
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

interface LoadProjectResponse {
  cloudaicompanionProject?: string;
}

// --- Service Implementation ---

export class GoogleAPIService {
  private static getFetchOptions() {
    try {
      const config = ConfigManager.loadConfig();
      if (config.proxy?.upstream_proxy?.enabled && config.proxy.upstream_proxy.url) {
        return {
          dispatcher: new ProxyAgent(config.proxy.upstream_proxy.url),
        };
      }
    } catch (e) {
      // Fallback or log if config load fails (shouldn't happen usually)
      console.warn('[GoogleAPIService] Failed to load proxy config', e);
    }
    return {};
  }

  /**
   * Generates the OAuth2 authorization URL.
   */
  static getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });

    return `${URLS.AUTH}?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for tokens.
   */
  static async exchangeCode(code: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const response = await fetch(URLS.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      ...this.getFetchOptions(),
    }).catch((err: unknown) => {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error(
            'Token exchange timed out. Please check your network connection and try again.',
          );
        }
      }
      throw err;
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${text}`);
    }

    return response.json() as Promise<TokenResponse>;
  }

  /**
   * Refreshes an access token using a refresh token.
   */
  static async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(URLS.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      ...this.getFetchOptions(),
    }).catch((err: unknown) => {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error(
            'Token refresh timed out. Please check your network connection and try again.',
          );
        }
      }
      throw err;
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed: ${text}`);
    }

    const data = (await response.json()) as TokenResponse;

    return data;
  }

  /**
   * Fetches user profile information.
   */
  static async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await fetch(URLS.USER_INFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      ...this.getFetchOptions(),
    }).catch((err: unknown) => {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error(
            'User info request timed out. Please check your network connection and try again.',
          );
        }
      }
      throw err;
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch user info: ${text}`);
    }

    return response.json() as Promise<UserInfo>;
  }

  /**
   * Core logic: Fetches the internal project ID needed for quota checks.
   */
  public static async fetchProjectId(accessToken: string): Promise<string | null> {
    const body = {
      metadata: { ideType: 'ANTIGRAVITY' },
    };

    // Simple retry logic (2 attempts)
    for (let i = 0; i < 2; i++) {
      try {
        const response = await fetch(URLS.LOAD_PROJECT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          ...this.getFetchOptions(),
        });

        if (response.ok) {
          const data = (await response.json()) as LoadProjectResponse;
          if (data.cloudaicompanionProject) {
            return data.cloudaicompanionProject;
          }
        }
      } catch (e) {
        console.warn(`[GoogleAPIService] Failed to fetch project ID (Attempt ${i + 1}):`, e);
        await new Promise((r) => setTimeout(r, 500)); // Sleep 500ms
      }
    }
    return null;
  }

  /**
   * Core logic: Fetches detailed model quota information.
   */
  static async fetchQuota(accessToken: string): Promise<QuotaData> {
    const result: QuotaData = { models: {} };
    
    // 1. Bus A: Internal Telemetry & Quota (v1internal)
    try {
      const projectId = await this.fetchProjectId(accessToken);
      const payload = projectId ? { project: projectId } : {};
      
      const response = await fetch(URLS.QUOTA, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        ...this.getFetchOptions(),
      });

      if (response.ok) {
        const data = (await response.json()) as { models: Record<string, ModelInfoRaw> };
        for (const [name, info] of Object.entries(data.models || {})) {
          const cleanName = name.replace(/^models\//, '');
          if (info.quotaInfo) {
            const fraction = info.quotaInfo.remainingFraction ?? 0;
            result.models[cleanName] = { 
              percentage: Math.floor(fraction * 100), 
              resetTime: info.quotaInfo.resetTime || '' 
            };
          }
        }
      }
    } catch (e) {
      console.warn('[GoogleAPIService] Bus A Failure - continuing to Catalogues', e);
    }

    // 2. Bus B & C: Exhaustive Catalogues (v1 & v1beta)
    // PhD Level: Pure Identity-based Discovery
    const catalogUrls = [
      `${URLS.LIST_MODELS_V1}?pageSize=1000`,
      `${URLS.LIST_MODELS_V1BETA}?pageSize=1000`
    ];

    for (const url of catalogUrls) {
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: createTimeoutSignal(10000),
          ...this.getFetchOptions(),
        });

        if (resp.ok) {
          const data = (await resp.json()) as { models: any[] };
          if (data.models && Array.isArray(data.models)) {
            data.models.forEach((m: any) => {
              const modelId = m.name?.replace(/^models\//, '');
              if (!modelId) return;

              // Higher Fidelity Metadata Mapping (following user benchmark)
              let contextWindow = m.inputTokenLimit || 32000;
              if (modelId.includes('gemini-1.5-pro')) contextWindow = 2000000;
              else if (modelId.includes('gemini-1.5-flash') || modelId.includes('gemini-2.0-flash')) contextWindow = 1000000;
              
              const finalContext = Math.min(contextWindow, 2000000);
              const completionTokens = m.outputTokenLimit ? Math.min(m.outputTokenLimit, 128000) : 8192;

              if (result.models[modelId]) {
                // Update existing telemetry with metadata
                result.models[modelId].displayName = m.displayName || modelId;
                result.models[modelId].maxTokenAllowed = finalContext;
                result.models[modelId].maxCompletionTokens = completionTokens;
              } else {
                // New model discovered in catalogue - 100% health baseline
                result.models[modelId] = {
                  percentage: 100,
                  resetTime: '',
                  displayName: m.displayName || modelId,
                  maxTokenAllowed: finalContext,
                  maxCompletionTokens: completionTokens
                };
              }
            });
          }
        }
      } catch (e) {
        console.warn(`[GoogleAPIService] Catalogue Discovery Failure at ${url}:`, e);
      }
    }

    return result;
  }

  /**
   * Fetches high-dimensional embeddings for semantic search.
   */
  static async fetchEmbedding(text: string, accessToken: string): Promise<Float32Array> {
    const payload = {
      model: 'models/text-embedding-004',
      content: { parts: [{ text }] },
    };

    try {
      const response = await fetch(URLS.EMBEDDING, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        ...this.getFetchOptions(),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Embedding API failure: ${errText}`);
      }

      const data = await response.json() as { embedding: { values: number[] } };
      return new Float32Array(data.embedding.values);
    } catch (e) {
      console.error('[GoogleAPIService] Failed to fetch embedding', e);
      throw e;
    }
  }
}
