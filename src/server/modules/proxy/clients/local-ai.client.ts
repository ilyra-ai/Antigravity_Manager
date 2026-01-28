import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export interface LocalAIConfig {
  baseUrl: string; // e.g., http://localhost:1234/v1 or http://localhost:11434/v1
  provider: 'ollama' | 'lmstudio';
}

@Injectable()
export class LocalAIClient {
  private readonly logger = new Logger(LocalAIClient.name);

  /**
   * PhD Level: Normalizes URLs to ensure consistent base regardless of user input format.
   * Strips trailing slashes, /models, and ensures /v1 is correctly positioned.
   */
  private normalizeUrl(url: string): string {
    let clean = url.trim().replace(/\/+$/, ''); // Remove trailing slashes
    clean = clean.replace(/\/models$/, '');     // Remove redundant /models
    clean = clean.replace(/\/+v1$/, '');        // Remove redundant /v1 for re-application
    return `${clean}/v1`;                      // Force standard v1 base
  }

  /**
   * Fetches the list of available models from the local backend.
   */
  async getModels(config: LocalAIConfig): Promise<string[]> {
    const baseUrl = this.normalizeUrl(config.baseUrl);
    try {
      this.logger.log(`Attempting hardware interrogation at: ${baseUrl}/models`);
      const response = await axios.get(`${baseUrl}/models`, { timeout: 5000 });
      const data = response.data;
      
      // OpenAI-compatible format (both LM Studio and newer Ollama support this)
      if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => m.id);
      }
      return [];
    } catch (error) {
      this.logger.warn(`Failed to fetch models from ${config.provider} at ${config.baseUrl}`);
      return [];
    }
  }

  /**
   * Generates a chat completion (Non-Streaming).
   */
  async generateChat(config: LocalAIConfig, body: any): Promise<any> {
    const baseUrl = this.normalizeUrl(config.baseUrl);
    const url = `${baseUrl}/chat/completions`;
    try {
      const response = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000, // 2 minutes for local models
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'GenerateChat');
    }
  }

  /**
   * Generates a chat completion (Streaming).
   * Returns the raw axios stream.
   */
  async streamChat(config: LocalAIConfig, body: any): Promise<any> {
    const baseUrl = this.normalizeUrl(config.baseUrl);
    const url = `${baseUrl}/chat/completions`;
    try {
      const response = await axios.post(url, { ...body, stream: true }, {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout: 120000,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'StreamChat');
    }
  }

  private handleError(error: any, context: string) {
    if (axios.isAxiosError(error)) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.error(`LocalAI ${context} Error: ${msg}`);
      throw new Error(msg);
    }
    throw error instanceof Error ? new Error(error.message) : new Error(String(error));
  }
}
