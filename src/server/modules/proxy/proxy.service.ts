import { Injectable, Logger, Inject } from '@nestjs/common';
import { TokenManagerService } from './token-manager.service';
import { GeminiClient } from './clients/gemini.client';
import { LocalAIClient } from './clients/local-ai.client';
import { v4 as uuidv4 } from 'uuid';
import { SemanticCacheManager } from './SemanticCacheManager';
import { AnthropicMessage, OpenAIMessage } from './interfaces/request-interfaces';
import { Observable, Subscriber } from 'rxjs';
import { transformClaudeRequestIn } from '../../../lib/antigravity/ClaudeRequestMapper';
import { transformResponse } from '../../../lib/antigravity/ClaudeResponseMapper';
import { StreamingState, PartProcessor } from '../../../lib/antigravity/ClaudeStreamingMapper';
import { ClaudeRequest } from '../../../lib/antigravity/types';
import { calculateRetryDelay, sleep } from '../../../lib/antigravity/retry-utils';
import {
  classifyStreamError,
  formatErrorForSSE,
} from '../../../lib/antigravity/stream-error-utils';
import {
  OpenAIChatRequest,
  AnthropicChatRequest,
  OpenAIContentPart,
  GeminiResponse,
  AnthropicChatResponse,
  OpenAIChatResponse,
  GeminiCandidate,
} from './interfaces/request-interfaces';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    @Inject(TokenManagerService) private readonly tokenManager: TokenManagerService,
    @Inject(GeminiClient) private readonly geminiClient: GeminiClient,
    @Inject(LocalAIClient) private readonly localAIClient: LocalAIClient,
  ) {}

  // --- Anthropic Handlers ---

  async handleAnthropicMessages(
    request: AnthropicChatRequest,
  ): Promise<AnthropicChatResponse | Observable<string>> {
    const targetModel = this.mapModel(request.model);
    this.logger.log(
      `Received Anthropic request for model: ${request.model} (Mapped: ${targetModel}, Stream: ${request.stream})`,
    );

    // Retry loop
    let lastError: unknown = null;
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
        if (i > 0) {
            const delay = calculateRetryDelay(i - 1);
            this.logger.log(`Retry attempt ${i + 1}/${maxRetries}, waiting ${delay}ms`);
            await sleep(delay);
        }

        const token = await this.tokenManager.getNextToken(request.model);
        if (!token) throw new Error(`No available accounts satisfy model: ${request.model}`);

        // 1. Local AI Routing
        if (token.provider?.startsWith('local-')) {
            const localConfig = {
                baseUrl: token.token.refresh_token,
                provider: token.provider === 'local-ollama' ? 'ollama' : ('lmstudio' as any)
            };
            const localModel = token.token.project_id || request.model;

            if (request.stream) {
                const stream = await this.localAIClient.streamChat(localConfig, { ...request, model: localModel });
                return this.processOpenAIStream(stream, request.model);
            } else {
                const response = await this.localAIClient.generateChat(localConfig, { ...request, model: localModel });
                return this.convertLocalToAnthropicResponse(response, request.model);
            }
        }

        // 2. Semantic Cache Check
        const promptText = this.extractLastUserMessage(request.messages);
        const cachedResponse = await SemanticCacheManager.findResponse(promptText, token.token.access_token);
        if (cachedResponse) {
            if (request.stream) return SemanticCacheManager.createMockStream(cachedResponse, request.model, true);
            return {
                id: `cache_${uuidv4()}`,
                type: 'message',
                role: 'assistant',
                model: request.model,
                content: [{ type: 'text', text: cachedResponse }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 0, output_tokens: 0 }
            } as AnthropicChatResponse;
        }

        try {
            const projectId = token.token.project_id!;
            const geminiBody = transformClaudeRequestIn(request as unknown as ClaudeRequest, projectId);

            if (request.stream) {
                const stream = await this.geminiClient.streamGenerateInternal(geminiBody, token.token.access_token);
                const responseStream = this.processAnthropicInternalStream(stream, geminiBody.model);
                this.captureStreamOutput(responseStream, promptText, geminiBody.model, token.token.access_token);
                return responseStream;
            } else {
                const response = await this.geminiClient.generateInternal(geminiBody, token.token.access_token);
                const finalResponse = transformResponse(response) as unknown as AnthropicChatResponse;
                const responseText = this.extractAnthropicText(finalResponse);
                SemanticCacheManager.captureAndStore(promptText, responseText, geminiBody.model, token.token.access_token);
                return finalResponse;
            }
        } catch (error) {
            lastError = error;
            if (this.shouldRetry(error instanceof Error ? error.message : String(error))) {
                this.tokenManager.markAsRateLimited(token.email);
            }
        }
    }
    throw lastError || new Error('Request failed after retries');
  }

  // --- OpenAI / Universal Handlers ---

  async handleChatCompletions(
    request: OpenAIChatRequest,
  ): Promise<OpenAIChatResponse | Observable<string>> {
    const targetModel = this.mapModel(request.model);
    this.logger.log(`Received OpenAI request for model: ${request.model} (Stream: ${request.stream})`);

    let lastError: unknown = null;
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
        const token = await this.tokenManager.getNextToken(request.model);
        if (!token) throw new Error(`No available accounts satisfy model: ${request.model}`);

        // 1. Local AI Routing
        if (token.provider?.startsWith('local-')) {
            const localConfig = {
                baseUrl: token.token.refresh_token,
                provider: token.provider === 'local-ollama' ? 'ollama' : ('lmstudio' as any)
            };
            const localModel = token.token.project_id || request.model;

            if (request.stream) {
                const stream = await this.localAIClient.streamChat(localConfig, { ...request, model: localModel });
                return this.processOpenAIStream(stream, request.model);
            } else {
                const response = await this.localAIClient.generateChat(localConfig, { ...request, model: localModel });
                return response;
            }
        }

        // 2. Semantic Cache Check
        const promptText = this.extractLastUserMessage(request.messages);
        const cachedResponse = await SemanticCacheManager.findResponse(promptText, token.token.access_token);
        if (cachedResponse) {
            if (request.stream) return SemanticCacheManager.createMockStream(cachedResponse, request.model, false);
            return {
                id: `cache_${uuidv4()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [{ index: 0, message: { role: 'assistant', content: cachedResponse }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            } as OpenAIChatResponse;
        }

        try {
            const claudeRequest = this.convertOpenAIToClaude(request);
            const projectId = token.token.project_id!;
            const geminiBody = transformClaudeRequestIn(claudeRequest as unknown as ClaudeRequest, projectId);

            if (request.stream) {
                const stream = await this.geminiClient.streamGenerateInternal(geminiBody, token.token.access_token);
                const responseStream = this.processOpenAIStream(stream, request.model);
                this.captureStreamOutput(responseStream, promptText, request.model, token.token.access_token, false);
                return responseStream;
            } else {
                const response = await this.geminiClient.generateInternal(geminiBody, token.token.access_token);
                const claudeResponse = transformResponse(response);
                const finalResponse = this.convertClaudeToOpenAIResponse(claudeResponse, request.model);
                SemanticCacheManager.captureAndStore(promptText, finalResponse.choices[0].message.content, request.model, token.token.access_token);
                return finalResponse;
            }
        } catch (error) {
            lastError = error;
            if (this.shouldRetry(error instanceof Error ? error.message : String(error))) {
                this.tokenManager.markAsRateLimited(token.email);
            }
        }
    }
    throw lastError || new Error('Request failed after retries');
  }

  // --- SSE Stream Processors ---

  private processAnthropicInternalStream(upstreamStream: any, model: string): Observable<string> {
    return new Observable<string>((subscriber: Subscriber<string>) => {
      const decoder = new TextDecoder();
      let buffer = '';
      const state = new StreamingState();
      const processor = new PartProcessor(state);
      let lastFinishReason: string | undefined;
      let lastUsageMetadata: any | undefined;
      let receivedData = false;

      upstreamStream.on('data', (chunk: Buffer) => {
        receivedData = true;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            const json = JSON.parse(dataStr);
            if (json) {
              const startMsg = state.emitMessageStart(json);
              if (startMsg) subscriber.next(startMsg);
            }
            const candidate = json.candidates?.[0];
            const part = candidate?.content?.parts?.[0];
            if (candidate?.finishReason) lastFinishReason = candidate.finishReason;
            if (json.usageMetadata) lastUsageMetadata = json.usageMetadata;
            if (part) {
              const chunks = processor.process(part as any);
              chunks.forEach((c) => subscriber.next(c));
            }
            state.resetErrorState();
          } catch (e) {
            const errorChunks = state.handleParseError(dataStr);
            errorChunks.forEach((c) => subscriber.next(c));
          }
        }
      });

      upstreamStream.on('end', () => {
        if (!receivedData) {
          subscriber.error(new Error('Empty response stream'));
          return;
        }
        const finishChunks = state.emitFinish(lastFinishReason, lastUsageMetadata);
        finishChunks.forEach((c) => subscriber.next(c));
        subscriber.complete();
      });

      upstreamStream.on('error', (err: any) => {
        const cleanError = err instanceof Error ? err : new Error(String(err));
        const { type, message } = classifyStreamError(cleanError);
        subscriber.next(formatErrorForSSE(type, message));
        subscriber.error(cleanError);
      });
    });
  }

  private processOpenAIStream(upstreamStream: any, model: string): Observable<string> {
    return new Observable<string>((subscriber: Subscriber<string>) => {
      const decoder = new TextDecoder();
      let buffer = '';
      const streamId = `chatcmpl-${uuidv4()}`;
      const created = Math.floor(Date.now() / 1000);

      upstreamStream.on('data', (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            const json = JSON.parse(dataStr);
            const candidate = json.candidates?.[0];
            const contentPart = candidate?.content?.parts?.[0];
            const text = contentPart?.text || json.choices?.[0]?.delta?.content || '';
            const finishReason = candidate?.finishReason || json.choices?.[0]?.finish_reason;

            if (text || finishReason) {
              const contentChunk = {
                id: streamId,
                object: 'chat.completion.chunk',
                created: created,
                model: model,
                choices: [{ index: 0, delta: { content: text }, finish_reason: finishReason?.toLowerCase() || null }]
              };
              subscriber.next(`data: ${JSON.stringify(contentChunk)}\n\n`);
            }
            if (finishReason) {
              subscriber.next('data: [DONE]\n\n');
              subscriber.complete();
            }
          } catch (e) {}
        }
      });

      upstreamStream.on('end', () => subscriber.complete());
      upstreamStream.on('error', (err: any) => subscriber.error(err instanceof Error ? err : new Error(String(err))));
    });
  }

  // --- Converters & Utilities ---

  private convertLocalToAnthropicResponse(localResponse: any, model: string): AnthropicChatResponse {
    const content = localResponse.choices?.[0]?.message?.content || '';
    return {
        id: `local_${uuidv4()}`,
        type: 'message',
        role: 'assistant',
        model: model,
        content: [{ type: 'text', text: content }],
        stop_reason: 'end_turn',
        usage: {
            input_tokens: localResponse.usage?.prompt_tokens || 0,
            output_tokens: localResponse.usage?.completion_tokens || 0
        }
    } as any;
  }

  private convertClaudeToOpenAIResponse(claudeResponse: any, model: string): OpenAIChatResponse {
    const content = claudeResponse.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('') || '';
    return {
      id: `chatcmpl-${uuidv4()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: claudeResponse.usage?.input_tokens || 0,
        completion_tokens: claudeResponse.usage?.output_tokens || 0,
        total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
      },
    };
  }

  private convertOpenAIToClaude(request: OpenAIChatRequest): AnthropicChatRequest {
    const messages = (request.messages || []).filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : ''
    }));
    const system = (request.messages || []).find(m => m.role === 'system')?.content as string;
    return {
      model: request.model,
      messages: messages as any,
      system: system,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature,
      stream: request.stream,
    };
  }

  private mapModel(m: string): string {
    const l = m.toLowerCase();
    if (l.includes('sonnet') || l.includes('thinking')) return 'gemini-3-pro-preview';
    if (l.includes('haiku')) return 'gemini-2.0-flash-exp';
    if (l.includes('opus')) return 'gemini-3-pro-preview';
    if (l.includes('claude')) return 'gemini-2.5-flash-thinking';
    return m;
  }

  private shouldRetry(msg: string): boolean {
    const l = msg.toLowerCase();
    return l.includes('429') || l.includes('quota') || l.includes('limit') || l.includes('resource_exhausted');
  }

  private extractLastUserMessage(messages: (AnthropicMessage | OpenAIMessage)[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        return typeof content === 'string' ? content : (content as any[]).filter(c => c.type === 'text').map(c => c.text).join('\n');
      }
    }
    return '';
  }

  private extractAnthropicText(response: AnthropicChatResponse): string {
    return (response.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  }

  private captureStreamOutput(stream: Observable<string>, prompt: string, model: string, token: string, isAnthropic = true) {
    let full = '';
    stream.subscribe({
      next: (chunk: string) => {
        try {
          const data = JSON.parse(chunk.replace('data: ', '').trim());
          if (isAnthropic) {
            if (data.delta?.text) full += data.delta.text;
          } else {
            if (data.choices?.[0]?.delta?.content) full += data.choices[0].delta.content;
          }
        } catch (e) {}
      },
      complete: () => { if (full) SemanticCacheManager.captureAndStore(prompt, full, model, token); }
    });
  }
}
