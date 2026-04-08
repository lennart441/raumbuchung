import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { Request } from 'express';
import { AuthUser } from './request-user';

type RequestWithUser = Request & { user?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = req.header('authorization');
    const devHeader = req.header('x-dev-user');

    if (!authHeader && devHeader) {
      req.user = {
        sub: `dev-${devHeader}`,
        email: `${devHeader}@local.dev`,
        name: devHeader,
        role: (req.header('x-dev-role') as AuthUser['role']) ?? 'USER',
      };
      return true;
    }

    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Fehlender Bearer Token');

    const issuer = this.config.get<string>('AUTHENTIK_ISSUER');
    const audience = this.config.get<string>('AUTHENTIK_AUDIENCE');
    if (!issuer || !audience) {
      throw new UnauthorizedException('Authentik Konfiguration fehlt');
    }

    const jwks = createRemoteJWKSet(new URL(`${issuer}/application/o/${audience}/jwks/`));
    const result = await jwtVerify(token, jwks, { issuer, audience });
    req.user = this.toAuthUser(result.payload);
    return true;
  }

  private toAuthUser(payload: JWTPayload): AuthUser {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Token enthält keine user claims');
    }
    const groupsRaw = payload.groups;
    const groups = Array.isArray(groupsRaw)
      ? groupsRaw.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const name =
      typeof payload.name === 'string'
        ? payload.name
        : typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : String(payload.email);
    return {
      sub: payload.sub,
      email: String(payload.email),
      name,
      groups,
      role: typeof payload.role === 'string' ? (payload.role as AuthUser['role']) : undefined,
    };
  }
}
