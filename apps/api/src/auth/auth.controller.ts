import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiExcludeEndpoint,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { truncateIp } from '@app-foundry/core';
import type { Env } from '@app-foundry/env';

import { ENV } from '../infrastructure/tokens.js';
import { AuthService } from './auth.service.js';
import { CurrentUserDto } from './auth.dto.js';
import { CurrentUserId } from './current-user.decorator.js';
import type { GitHubProfile } from './github.strategy.js';
import { Public } from './public.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SESSION_COOKIE, SessionGuard } from './session.guard.js';
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
  @Public()
  @Get('github')
  @UseGuards(RateLimitGuard, AuthGuard('github'))
  @ApiOperation({ summary: 'Iniciar sesión con GitHub' })
  signIn(): void {
    // Passport redirige antes de llegar aquí.
  }

  @Public()
  @Get('github/callback')
  @UseGuards(RateLimitGuard, AuthGuard('github'))
  @ApiExcludeEndpoint()
  async callback(
    @Req() request: Request & { user?: GitHubProfile },
    @Res() response: Response,
  ): Promise<void> {
    if (!request.user) throw new UnauthorizedException('GitHub no devolvió ningún profile');

    const user = await this.auth.provision(request.user);
    const token = await this.sessions.create(
      user.id,
      truncateIp(request.ip),
      request.get('user-agent') ?? null,
    );

    response.cookie(SESSION_COOKIE, token, this.cookieOptions());
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
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) await this.sessions.revoke(token);
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Delete('me')
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: 'Darse de baja',
    description:
      'Apaga la cuenta y arranca el plazo de gracia: nada se borra, y volver a entrar dentro del plazo la reactiva. El borrado definitivo lo ejecuta un administrador (RF-207).',
  })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @CurrentUserId() userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.deactivateSelf(userId);
    // La sesión ya no vale; la cookie tampoco debe quedarse por ahí.
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Quién soy' })
  @ApiOkResponse({ type: CurrentUserDto })
  async me(@CurrentUserId() userId: string): Promise<CurrentUserDto> {
    return this.auth.profile(userId);
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.env.NODE_ENV === 'production',
      path: '/',
      maxAge: this.env.SESSION_TTL_DAYS * 86_400_000,
    };
  }
}
