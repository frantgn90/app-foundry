import {
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import type { Env } from '@app-foundry/env';

import { ENV } from '../infrastructure/tokens.js';
import { AuthService, type UsuarioAutenticado } from './auth.service.js';
import { UsuarioActualDto } from './auth.dto.js';
import { UsuarioActual } from './current-user.decorator.js';
import type { PerfilGitHub } from './github.strategy.js';
import { Publico } from './public.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { COOKIE_SESION, SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Lleva a GitHub. Passport se encarga de la redirección y del `state`. */
  @Publico()
  @Get('github')
  @UseGuards(RateLimitGuard, AuthGuard('github'))
  @ApiOperation({ summary: 'Iniciar sesión con GitHub' })
  iniciar(): void {
    // Passport redirige antes de llegar aquí.
  }

  @Publico()
  @Get('github/callback')
  @UseGuards(RateLimitGuard, AuthGuard('github'))
  @ApiExcludeEndpoint()
  async callback(
    @Req() request: Request & { user?: PerfilGitHub },
    @Res() response: Response,
  ): Promise<void> {
    if (!request.user) throw new UnauthorizedException('GitHub no devolvió ningún perfil');

    const usuario = await this.auth.provisionar(request.user);
    const token = await this.sessions.crear(
      usuario.id,
      this.ipTruncada(request.ip),
      request.get('user-agent') ?? null,
    );

    response.cookie(COOKIE_SESION, token, this.opcionesCookie());
    // De vuelta a la aplicación, que ya consultará /me para saber quién eres.
    response.redirect(this.env.WEB_ORIGIN);
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Cerrar sesión' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = (request.cookies as Record<string, string> | undefined)?.[COOKIE_SESION];
    if (token) await this.sessions.revocar(token);
    response.clearCookie(COOKIE_SESION, this.opcionesCookie());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Quién soy' })
  @ApiOkResponse({ type: UsuarioActualDto })
  yo(@UsuarioActual() usuario: UsuarioAutenticado): UsuarioActualDto {
    return usuario;
  }

  private opcionesCookie() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.env.NODE_ENV === 'production',
      path: '/',
      maxAge: this.env.SESSION_TTL_DAYS * 86_400_000,
    };
  }

  /**
   * IP recortada a /24 (o /48 en IPv6).
   *
   * Sirve para que alguien reconozca una sesión suya, no para rastrearle
   * (RF-706, RNF-112).
   */
  private ipTruncada(ip: string | undefined): string | null {
    if (!ip) return null;
    if (ip.includes(':')) {
      const grupos = ip.split(':').slice(0, 3);
      return `${grupos.join(':')}::`;
    }
    const octetos = ip.split('.');
    if (octetos.length !== 4) return null;
    return `${octetos.slice(0, 3).join('.')}.0`;
  }
}
