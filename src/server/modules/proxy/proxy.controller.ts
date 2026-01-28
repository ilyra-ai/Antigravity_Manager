import { Controller, Get, Post, Body, Res, UseGuards, Inject, Logger, HttpStatus, Headers as ReqHeaders } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ProxyService } from './proxy.service';
import { Observable } from 'rxjs';
import { OpenAIChatRequest, AnthropicChatRequest } from './interfaces/request-interfaces';
import { ProxyGuard } from './proxy.guard';
import { CloudAccountRepo } from '../../../ipc/database/cloudHandler';

@Controller()
@UseGuards(ProxyGuard)
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(@Inject(ProxyService) private readonly proxyService: ProxyService) { }

  @Get('v1/models')
  async getModels() {
    try {
      const accounts = await CloudAccountRepo.getAccounts();
      const activeAccount = accounts.find(a => a.is_active);

      let models: any[] = [];

      if (activeAccount && activeAccount.selected_models && activeAccount.selected_models.length > 0) {
        // User Filtered Intelligence - Respecting selection sovereignty
        models = activeAccount.selected_models.map(m => ({
          id: m,
          object: 'model',
          created: activeAccount.created_at,
          owned_by: activeAccount.provider
        }));
      } else if (activeAccount && activeAccount.quota?.models) {
        // Fallback to all available intelligence for this account
        models = Object.keys(activeAccount.quota.models).map(m => ({
          id: m,
          object: 'model',
          created: activeAccount.created_at,
          owned_by: activeAccount.provider
        }));
      } else {
        // Ultimate Baseline Recovery - High Availability Defaults
        models = [
          { id: 'gemini-2.5-flash-thinking', object: 'model', created: 1734336000, owned_by: 'google' },
          { id: 'gemini-2.5-flash', object: 'model', created: 1734336000, owned_by: 'google' },
          { id: 'gemini-2.5-pro', object: 'model', created: 1734336000, owned_by: 'google' },
          { id: 'claude-3-5-sonnet-v2', object: 'model', created: 1734336000, owned_by: 'anthropic' },
          { id: 'claude-3-5-haiku', object: 'model', created: 1734336000, owned_by: 'anthropic' },
        ];
      }

      // Add local hardware discovery results for edge intelligence
      const localAccounts = accounts.filter(a => a.provider.startsWith('local-'));
      for (const acc of localAccounts) {
        const modelId = acc.token.project_id || acc.email.split('@')[0];
        if (!models.find(m => m.id === modelId)) {
          models.push({
            id: modelId,
            object: 'model',
            created: acc.created_at,
            owned_by: acc.provider,
            local: true
          });
        }
      }

      return { object: 'list', data: models };
    } catch (e) {
      console.error('[Gateway] Failed to synthesize model ecosystem:', e);
      return { object: 'list', data: [] };
    }
  }

  @Post('v1/chat/completions')
  async chatCompletions(@Body() body: OpenAIChatRequest, @Res() res: FastifyReply) {
    try {
      const result = await this.proxyService.handleChatCompletions(body);

      if (body.stream && result instanceof Observable) {
        res.header('Content-Type', 'text/event-stream');
        res.header('Cache-Control', 'no-cache');
        res.header('Connection', 'keep-alive');
        res.send(result);
      } else {
        res.status(HttpStatus.OK).send(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        error: {
          message: message,
          type: 'server_error',
        },
      });
    }
  }

  @Post('v1/messages')
  async anthropicMessages(@Body() body: AnthropicChatRequest, @Res() res: FastifyReply) {
    try {
      const result = await this.proxyService.handleAnthropicMessages(body);

      if (body.stream && result instanceof Observable) {
        res.header('Content-Type', 'text/event-stream');
        res.header('Cache-Control', 'no-cache');
        res.header('Connection', 'keep-alive');
        res.send(result);
      } else {
        res.status(HttpStatus.OK).send(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        type: 'error',
        error: {
          type: 'api_error',
          message: message,
        },
      });
    }
  }

  /**
   * PhD Level: Internal Google Protocol Masquerading
   * The IDE calls this specific endpoint to obtain the list of available models.
   * By intercepting it, we inject our local hardware and filtered selections.
   */
  @Post('v1internal\\:fetchAvailableModels')
  async internalFetchModels() {
    this.logger.log('Intercepted sovereign model list request from IDE');
    const modelList = await this.getModels();

    // Convert OpenAI list format to Google internal structure
    const googleModels: Record<string, any> = {};
    modelList.data.forEach((m: any) => {
      googleModels[`models/${m.id}`] = {
        quotaInfo: {
          remainingFraction: 1.0,
          resetTime: ""
        }
      };
    });

    return { models: googleModels };
  }

  /**
   * PhD Level: Onboarding Sovereignty
   * The IDE calls this to check for an active Google Cloud project.
   * Returning a mock project ID allows the setup to complete.
   */
  @Post('v1internal\\:loadCodeAssist')
  async internalLoadCodeAssist() {
    this.logger.log('Intercepted sovereign setup request (loadCodeAssist) from IDE');
    return {
      cloudaicompanionProject: 'antigravity-sovereign-project'
    };
  }

  // --- Sovereign Identity Simulation (PhD Level) ---

  /**
   * Simulates Google's UserInfo endpoint (v1).
   * Essential for the IDE to "verify" the user identity when using a local token.
   */
  @Get('oauth2/v1/userinfo')
  async getUserInfoV1(@ReqHeaders('authorization') authHeader: string) {
    return this.getSovereignProfile(authHeader);
  }

  /**
   * Simulates Google's UserInfo endpoint (v2).
   * Fallback for different client versions.
   */
  @Get('oauth2/v2/userinfo')
  async getUserInfoV2(@ReqHeaders('authorization') authHeader: string) {
    return this.getSovereignProfile(authHeader);
  }

  /**
   * Simulates Google People API "people/me".
   * Some newer IDE versions prefer this endpoint.
   */
  @Get('v1/people/me')
  async getPeopleMe(@ReqHeaders('authorization') authHeader: string) {
    const profile = this.getSovereignProfile(authHeader);
    // People API format is slightly different
    return {
      resourceName: `people/${profile.id}`,
      etag: "%EgUBAgID",
      names: [{
        metadata: { primary: true, source: { type: "PROFILE", id: profile.id } },
        displayName: profile.name,
        familyName: profile.family_name,
        givenName: profile.given_name,
        displayNameLastFirst: `${profile.family_name}, ${profile.given_name}`
      }],
      photos: [{
        metadata: { primary: true, source: { type: "PROFILE", id: profile.id } },
        url: profile.picture
      }],
      emailAddresses: [{
        metadata: { primary: true, source: { type: "ACCOUNT", id: profile.id } },
        value: profile.email
      }]
    };
  }

  private getSovereignProfile(authHeader: string | undefined): any {
    // Default Sovereign Profile
    const profile = {
      id: "sovereign-hardware", // Fixed ID for stability
      email: "local-hardware@antigravity.os",
      verified_email: true,
      name: "Sovereign Intelligence",
      given_name: "Sovereign",
      family_name: "Intelligence",
      picture: "https://www.gstatic.com/lamda/images/sparkle_resting_v2_darkmode_2e04640a5107e44a.gif", // Cool sparkle avatar
      locale: "pt-BR",
      hd: "antigravity.os"
    };

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // If it sends the ID in the token string (our format: ya29.SovereignHardware-ID-TIMESTAMP)
      if (token.includes('SovereignHardware-')) {
        const parts = token.split('-');
        if (parts.length >= 3) {
          // Try to extract ID implies we could have multiple local profiles if needed
          // But for now, returning the one valid profile is safer.
          this.logger.log(`Validating Sovereign Identity for token: ${token.substring(0, 30)}...`);
        }
      }
    }

    return profile;
  }
}
