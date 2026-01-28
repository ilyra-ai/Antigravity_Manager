
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapNestServer } from '../../server/main'; // Adjust path if needed
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

// Mock NestFactory
vi.mock('@nestjs/core', async () => {
  const actual = await vi.importActual('@nestjs/core');
  return {
    ...actual,
    NestFactory: {
      create: vi.fn(),
    },
  };
});

// Mock Logger to avoid cluttering test output
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Server Config
vi.mock('../../server/server-config', () => ({
  setServerConfig: vi.fn(),
}));

describe('Security Regression Tests', () => {
  let appMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup the mock application
    appMock = {
      enableCors: vi.fn(),
      useGlobalFilters: vi.fn(),
      useGlobalInterceptors: vi.fn(),
      listen: vi.fn().mockResolvedValue(true),
      get: vi.fn(),
      close: vi.fn().mockResolvedValue(true),
    };
    
    (NestFactory.create as any).mockResolvedValue(appMock);
  });

  afterEach(async () => {
    const { stopNestServer } = await import('../../server/main');
    await stopNestServer();
    vi.restoreAllMocks();
  });

  describe('CRITICAL: Network Binding Security', () => {
    it('should bind ONLY to localhost (127.0.0.1) and NEVER to 0.0.0.0', async () => {
      // Act
      const config = { port: 8045, auth_token: 'test-token' };
      await bootstrapNestServer(config);

      // Assert
      expect(appMock.listen).toHaveBeenCalled();
      
      const listenCalls = appMock.listen.mock.calls;
      const firstCall = listenCalls[0]; // [port, address]
      
      const portArg = firstCall[0];
      const addressArg = firstCall[1];

      expect(portArg).toBe(8045);
      
      // The core security assertion
      expect(addressArg).toBe('127.0.0.1');
      expect(addressArg).not.toBe('0.0.0.0'); // Explicitly forbid insecure bind
    });
  });
});
