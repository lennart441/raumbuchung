import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { Request } from 'express';
import { AuthUser } from './request-user';
import { resolveRoleFromClaims } from './role-resolution';

type RequestWithUser = Request & { user?: AuthUser };
type AuthMode = 'dev' | 'oidc';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private cachedJwksUrl?: string;
  private cachedJwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = req.header('authorization');
    const devHeader = req.header('x-dev-user');
    const mode = this.getAuthMode();

    if (mode === 'dev' && !authHeader && devHeader) {
      req.user = {
        sub: `dev-${devHeader}`,
        email: `${devHeader}@local.dev`,
        name: devHeader,
        role: (req.header('x-dev-role') as AuthUser['role']) ?? 'USER',
      };
      this.logAuth('dev-header-auth', req, req.user.sub);
      return true;
    }

    if (mode === 'oidc' && devHeader && !authHeader) {
      this.logAuth('dev-header-rejected', req);
      throw new UnauthorizedException('Dev-Header sind im OIDC-Modus deaktiviert');
    }

    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      this.logAuth('missing-bearer', req);
      throw new UnauthorizedException('Fehlender Bearer Token');
    }

    const issuer = this.config.get<string>('AUTHENTIK_ISSUER');
    const audience = this.config.get<string>('AUTHENTIK_AUDIENCE');
    if (!issuer || !audience) {
      this.logAuth('auth-config-missing', req);
      throw new UnauthorizedException('Authentik Konfiguration fehlt');
    }

    const jwks = this.getJwks(issuer);
    const clockTolerance = this.getClockToleranceSeconds();
    try {
      const result = await jwtVerify(token, jwks, { issuer, audience, clockTolerance });
      req.user = this.toAuthUser(result.payload);
      this.logAuth('oidc-auth-success', req, req.user.sub);
      return true;
    } catch (error: unknown) {
      const reason = this.mapTokenError(error);
      this.logAuth('oidc-auth-failed', req, undefined, reason);
      throw new UnauthorizedException(reason);
    }
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
      role: this.mapRoleClaim(typeof payload.role === 'string' ? payload.role : undefined),
    };
  }

  private getAuthMode(): AuthMode {
    const rawMode = this.config.get<string>('AUTH_MODE');
    if (rawMode === 'dev' || rawMode === 'oidc') return rawMode;
    const nodeEnv = this.config.get<string>('NODE_ENV');
    return nodeEnv === 'production' ? 'oidc' : 'dev';
  }

  private getJwks(issuer: string) {
    const configuredJwks = this.config.get<string>('AUTHENTIK_JWKS_URL');
    const fallbackJwks = `${issuer.replace(/\/+$/, '')}/jwks/`;
    const resolvedJwksUrl = configuredJwks?.trim() || fallbackJwks;
    if (this.cachedJwks && this.cachedJwksUrl === resolvedJwksUrl) {
      return this.cachedJwks;
    }
    this.cachedJwksUrl = resolvedJwksUrl;
    this.cachedJwks = createRemoteJWKSet(new URL(resolvedJwksUrl), {
      timeoutDuration: this.getJwksTimeoutMs(),
      cooldownDuration: 30_000,
      cacheMaxAge: 60 * 60 * 1000,
    });
    return this.cachedJwks;
  }

  private getJwksTimeoutMs(): number {
    const raw = Number(this.config.get<string>('AUTH_JWKS_TIMEOUT_MS') ?? '5000');
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }

  private getClockToleranceSeconds(): number {
    const raw = Number(this.config.get<string>('AUTH_CLOCK_TOLERANCE_SEC') ?? '5');
    return Number.isFinite(raw) && raw >= 0 ? raw : 5;
  }

  private mapRoleClaim(role?: string): AuthUser['role'] | undefined {
    if (!role) return undefined;
    const mapped = resolveRoleFromClaims(role, []);
    if (mapped === 'ADMIN') return 'ADMIN';
    if (mapped === 'EXTENDED_USER') return 'EXTENDED_USER';
    return 'USER';
  }

  private mapTokenError(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === 'JWTExpired') return 'Token ist abgelaufen';
      if (error.name === 'JWTClaimValidationFailed') return 'Token Claim Validierung fehlgeschlagen';
      if (error.name === 'JWSSignatureVerificationFailed') return 'Token Signatur ungueltig';
    }
    return 'Ungueltiger Bearer Token';
  }

  private logAuth(event: string, req: RequestWithUser, sub?: string, reason?: string) {
    this.logger.log(
      JSON.stringify({
        event,
        reason,
        sub,
        path: req.path,
        method: req.method,
        ip: req.ip,
      }),
    );
  }
}
