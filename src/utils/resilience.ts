import { logger } from './logger';

/**
 * PhD Level: Resilience Patterns
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay?: number;
  jitter?: boolean;
}

/**
 * Exponential Backoff with Jitter
 * Formula: min(maxDelay, base * 2^attempt + jitter)
 */
export async function exponentialBackoff(
  attempt: number,
  options: RetryOptions = { maxAttempts: 3, baseDelay: 1000, jitter: true }
): Promise<void> {
  const { baseDelay, maxDelay = 30000, jitter = true } = options;
  let delay = Math.pow(2, attempt) * baseDelay;
  
  if (jitter) {
    delay += Math.random() * 1000;
  }

  const finalDelay = Math.min(delay, maxDelay);
  logger.debug(`[Resilience] Backoff: Waiting ${Math.round(finalDelay)}ms (Attempt ${attempt + 1})`);
  return new Promise((resolve) => setTimeout(resolve, finalDelay));
}

/**
 * Circuit Breaker Pattern
 */
export enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime?: number;
  private nextHalfOpenTime?: number;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeout: number = 30000
  ) {}

  async execute<T>(task: () => Promise<T>): Promise<T> {
    this.updateState();

    if (this.state === CircuitState.OPEN) {
      throw new Error('[Resilience] Circuit is OPEN. Request rejected.');
    }

    try {
      const result = await task();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private updateState(): void {
    if (this.state === CircuitState.OPEN && this.nextHalfOpenTime && Date.now() > this.nextHalfOpenTime) {
      this.state = CircuitState.HALF_OPEN;
      logger.warn('[Resilience] Circuit is HALF-OPEN. Testing service health...');
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN || this.state === CircuitState.OPEN) {
      logger.info('[Resilience] Circuit is now CLOSED. Service recovered.');
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextHalfOpenTime = Date.now() + this.resetTimeout;
      logger.error(`[Resilience] Circuit is OPEN. Threshold reached (${this.failureCount} failures).`);
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Bulkhead Pattern: Semaphore for Concurrency Control
 */
export class Semaphore {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.activeCount--;
    if (this.queue.length > 0) {
      this.activeCount++;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

/**
 * PhD Level: Retry Decorator/Wrapper
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions = { maxAttempts: 3, baseDelay: 1000, jitter: true }
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await task();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < options.maxAttempts - 1) {
        await exponentialBackoff(attempt, options);
      }
    }
  }
  throw lastError;
}
