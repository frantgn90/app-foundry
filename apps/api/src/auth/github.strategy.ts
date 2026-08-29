import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Redis } from 'ioredis';
import { Strategy } from 'passport-oauth2';

import type { Env } from '@app-foundry/env';

import { ENV, REDIS } from '../infrastructure/tokens.js';
import { RedisStateStore } from './state-store.js';

/** Lo que necesitamos de GitHub, y nada más. */
export interface PerfilGitHub {
  githubId: number;
  handle: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

interface RespuestaUsuario {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface RespuestaEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Estrategia OAuth apuntada a GitHub.
 *
 * Se usa `passport-oauth2`, la estrategia genérica que mantiene el propio
 * equipo de Passport, en lugar de `passport-github2`, que lleva sin publicarse
 * desde 2022 (T-5). Cuesta unas líneas más y elimina una dependencia sin
 * mantenimiento justo en la puerta de entrada del producto.
 *
 * No se pide PKCE porque las OAuth Apps clásicas de GitHub no lo soportan; el
 * flujo es servidor a servidor y va firmado con el client secret, y el `state`
 * de un solo uso cubre el CSRF de login (RNF-105).
 */
@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(@Inject(ENV) env: Env, @Inject(REDIS) redis: Redis) {
    super({
      authorizationURL: 'https://github.com/login/oauth/authorize',
      tokenURL: 'https://github.com/login/oauth/access_token',
      clientID: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      callbackURL: `http://localhost:${String(env.PORT)}/api/v1/auth/github/callback`,
      // Solo identificación: ningún permiso sobre repositorios en v1 (RNF-111).
      scope: ['read:user', 'user:email'],
      store: new RedisStateStore(redis),
    });
  }

  /**
   * GitHub no devuelve el perfil en el intercambio del token, así que se pide
   * aparte. El email se consulta en su propio endpoint porque el del perfil
   * puede ser nulo si la persona lo tiene oculto, y necesitamos uno verificado.
   */
  async validate(accessToken: string): Promise<PerfilGitHub> {
    const cabeceras = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'app-foundry',
    };

    const respuestaUsuario = await fetch('https://api.github.com/user', { headers: cabeceras });
    if (!respuestaUsuario.ok) {
      throw new Error(`GitHub respondió ${String(respuestaUsuario.status)} al pedir el perfil`);
    }
    const usuario = (await respuestaUsuario.json()) as RespuestaUsuario;

    const email = await this.emailVerificado(cabeceras, usuario.email);
    if (email === null) {
      // Sin email verificado no se puede dar de alta (RF-103): es lo que
      // relaciona a la persona con las invitaciones que le hayan enviado.
      throw new Error('Tu cuenta de GitHub no tiene ningún email verificado');
    }

    return {
      githubId: usuario.id,
      handle: usuario.login,
      email,
      displayName: usuario.name ?? usuario.login,
      avatarUrl: usuario.avatar_url,
    };
  }

  private async emailVerificado(
    cabeceras: Record<string, string>,
    emailDelPerfil: string | null,
  ): Promise<string | null> {
    const respuesta = await fetch('https://api.github.com/user/emails', { headers: cabeceras });
    if (respuesta.ok) {
      const emails = (await respuesta.json()) as RespuestaEmail[];
      const principal =
        emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (principal) return principal.email;
    }
    return emailDelPerfil;
  }
}
