import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { logger } from '../utils/logger';
import { TokenManagerService } from './modules/proxy/token-manager.service';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

import { ProxyConfig } from '../types/config';
import { setServerConfig } from './server-config';

let app: NestFastifyApplication | null = null;
let currentPort: number = 0;

export async function bootstrapNestServer(config: ProxyConfig): Promise<boolean> {
  const port = config.port || 8045;
  
  // PhD Level: Deterministic Lifecycle Management
  // Ensure any previous instance is completely purged before starting a new one
  if (app) {
    logger.warn('NestJS server already exists. Attempting to restart...');
    const stopped = await stopNestServer();
    if (!stopped) {
      logger.error('Failed to purge existing NestJS instance. Aborting bootstrap to prevent route conflicts.');
      return false;
    }
  }

  setServerConfig(config);

  try {
    const adapter = new FastifyAdapter();
    app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
      logger: ['error', 'warn', 'log'],
    });

    // Enable CORS
    app.enableCors();

    // Global Filters & Interceptors (PhD Level)
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());

    await app.listen(port, '127.0.0.1');
    currentPort = port;
    logger.info(`NestJS Proxy Server running on http://localhost:${port}`);
    return true;
  } catch (error: unknown) {
    logger.error('Failed to start NestJS server', error);
    app = null; // Reset on failure
    return false;
  }
}

export async function stopNestServer(): Promise<boolean> {
  if (app) {
    try {
      logger.info('Stopping NestJS server...');
      
      // PhD Level: Graceful but Absolute Shutdown
      // 1. Close the Nest application
      await app.close();
      
      // 2. Explicitly nullify references to allow GC and prevent route leaks
      app = null;
      currentPort = 0;
      
      logger.info('NestJS server stopped successfully.');
      return true;
    } catch (error: unknown) {
      logger.error('Failed to stop NestJS server gracefully', error);
      // Force cleanup even on error
      app = null;
      currentPort = 0;
      return false;
    }
  }
  return true;
}

export function isNestServerRunning(): boolean {
  return app !== null;
}

export async function getNestServerStatus(): Promise<{
  running: boolean;
  port: number;
  base_url: string;
  active_accounts: number;
}> {
  const running = isNestServerRunning();
  let activeAccounts = 0;

  if (app) {
    try {
      const tokenManager = app.get(TokenManagerService);
      activeAccounts = tokenManager.getAccountCount();
    } catch (error: unknown) {
      // TokenManager might not be available
    }
  }

  return {
    running,
    port: currentPort,
    base_url: running ? `http://localhost:${currentPort}` : '',
    active_accounts: activeAccounts,
  };
}
