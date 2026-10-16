import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateSessionBody, JoinSessionBody } from '@kart/shared';
import { SessionsService } from './sessions.service';

@Controller('api')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('health')
  health() {
    return { ok: true, serverTime: Date.now() };
  }

  @Get('sessions')
  list(@Query('limit') limit?: string) {
    return this.sessions.list(limit ? +limit : 30);
  }

  @Post('sessions')
  create(@Body() body: CreateSessionBody) {
    return this.sessions.create(body);
  }

  @Post('sessions/:code/join')
  join(@Param('code') code: string, @Body() body: JoinSessionBody) {
    return this.sessions.join(code, body?.pilotName, body?.requestId);
  }

  @Get('sessions/:code')
  async get(@Param('code') code: string) {
    return (await this.sessions.getRuntime(code)).snapshot(Date.now());
  }

  @Get('sessions/:code/report')
  report(@Param('code') code: string) {
    return this.sessions.generalReport(code);
  }

  @Get('sessions/:code/pilots/:pilotId/report')
  pilotReport(@Param('code') code: string, @Param('pilotId') pilotId: string) {
    return this.sessions.pilotReport(code, pilotId);
  }

  @Get('sessions/:code/pilots/:pilotId/trace')
  trace(@Param('code') code: string, @Param('pilotId') pilotId: string, @Query('lap') lap?: string, @Query('raw') raw?: string) {
    // ?raw=1 devolve os pontos brutos do celular (útil para comparar com o suavizado)
    return this.sessions.pilotTrace(code, pilotId, lap ? +lap : undefined, raw === '1');
  }
}
