import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { TokenManagerService } from './token-manager.service';
import { GeminiClient } from './clients/gemini.client';
import { LocalAIClient } from './clients/local-ai.client';

@Module({
  controllers: [ProxyController],
  providers: [ProxyService, TokenManagerService, GeminiClient, LocalAIClient],
})
export class ProxyModule {}
