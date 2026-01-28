import { Observable, Subscriber } from 'rxjs';
import { SemanticCacheRepo } from '../../../ipc/database/semanticCache';
import { GoogleAPIService } from '../../../services/GoogleAPIService';
import { logger } from '../../../utils/logger';

export class SemanticCacheManager {
  /**
   * Attempts to retrieve a cached response using both exact and semantic matching.
   */
  static async findResponse(prompt: string, accessToken: string): Promise<string | null> {
    // 1. O(1) Exact Match Check
    const exactHit = SemanticCacheRepo.findExact(prompt);
    if (exactHit) {
      logger.info('[SemanticCache] Exact Hit Managed (0ms latency)');
      return exactHit;
    }

    // 2. Vector Semantic Check
    try {
      const embedding = await GoogleAPIService.fetchEmbedding(prompt, accessToken);
      const semanticHit = SemanticCacheRepo.findSemantic(embedding);
      if (semanticHit) {
        return semanticHit;
      }
    } catch (e) {
      logger.warn('[SemanticCache] Semantic lookup skipped due to embedding failure', e);
    }

    return null;
  }

  /**
   * Encapsulates a result in the cache for future use.
   */
  static async captureAndStore(prompt: string, response: string, model: string, accessToken: string) {
    try {
      const embedding = await GoogleAPIService.fetchEmbedding(prompt, accessToken);
      await SemanticCacheRepo.save({
        prompt_text: prompt,
        response: response,
        model: model,
        embedding: embedding
      });
    } catch (e) {
      logger.error('[SemanticCache] Background caching failed', e);
    }
  }

  /**
   * Creates an SSE stream from a cached string.
   * PhD Level: Mimic real streaming behavior for UI consistency.
   */
  static createMockStream(content: string, model: string, isAnthropic: boolean): Observable<string> {
    return new Observable<string>((subscriber: Subscriber<string>) => {
        if (isAnthropic) {
            // Anthropic SSE Format
            subscriber.next(`data: {"type": "message_start", "message": {"id": "cache_hit", "role": "assistant", "model": "${model}", "content": [], "usage": {"input_tokens": 0, "output_tokens": 0}}}\n\n`);
            subscriber.next(`data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n\n`);
            subscriber.next(`data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": ${JSON.stringify(content)}}}\n\n`);
            subscriber.next(`data: {"type": "content_block_stop", "index": 0}\n\n`);
            subscriber.next(`data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}, "usage": {"output_tokens": 0}}\n\n`);
            subscriber.next(`data: {"type": "message_stop"}\n\n`);
        } else {
            // OpenAI SSE Format
            subscriber.next(`data: ${JSON.stringify({
                id: 'cache-hit',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{ index: 0, delta: { content: content }, finish_reason: 'stop' }]
            })}\n\n`);
            subscriber.next('data: [DONE]\n\n');
        }
        subscriber.complete();
    });
  }
}
