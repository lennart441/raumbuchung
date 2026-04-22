import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { Request } from 'express';
import { AuthUser } from './request-user';
import { resolveRoleFromClaims } from './role-resolution';
import { AuthentikProfileService } from './authentik-profile.service';

type RequestWithUser = Request & { user?: AuthUser };
type AuthMode = 'dev' | 'oidc';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private cachedJwksUrl?: string;
  private cachedJwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ConfigService,
    private readonly authentikProfileService: AuthentikProfileService,
  ) {}

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
      throw new UnauthorizedException(
        'Dev-Header sind im OIDC-Modus deaktiviert',
      );
    }

    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      this.logAuth('missing-bearer', req);
      throw new UnauthorizedException('Fehlender Bearer Token');
    }

    const issuer = this.getConfig(
      'AUTHENTIK_OIDC_ISSUER',
      'AUTHENTIK_ISSUER',
    );
    const audience = this.getConfig(
      'AUTHENTIK_OIDC_AUDIENCE',
      'AUTHENTIK_AUDIENCE',
      'AUTHENTIK_OIDC_CLIENT_ID',
    );
    if (!issuer || !audience) {
      this.logAuth('auth-config-missing', req);
      throw new UnauthorizedException('Authentik Konfiguration fehlt');
    }
    this.ensureSecureIssuer(issuer);

    const jwks = this.getJwks(issuer);
    const acceptedIssuers = this.getAcceptedIssuers(issuer);
    const clockTolerance = this.getClockToleranceSeconds();
    try {
      const result = await jwtVerify(token, jwks, {
        issuer: acceptedIssuers,
        audience,
        clockTolerance,
      });
      req.user = await this.toAuthUser(result.payload, token, issuer);
      this.logAuth('oidc-auth-success', req, req.user.sub);
      return true;
    } catch (error: unknown) {
      const reason = this.mapTokenError(error);
      this.logAuth('oidc-auth-failed', req, undefined, reason);
      throw new UnauthorizedException(reason);
    }
  }

  private async toAuthUser(
    payload: JWTPayload,
    accessToken: string,
    issuer: string,
  ): Promise<AuthUser> {
    if (!payload.sub || typeof payload.email !== 'string') {
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
          : payload.email;
    const fromClaims = this.extractProfileClaims(payload);
    const fromUserInfo =
      this.shouldFetchUserInfoProfile(fromClaims) &&
      this.isUserInfoFallbackEnabled()
        ? await this.authentikProfileService.fetchProfile(accessToken, issuer)
        : undefined;

    return {
      sub: payload.sub,
      email: payload.email,
      name,
      phone: fromClaims.phone ?? fromUserInfo?.phone,
      birthDate: fromClaims.birthDate ?? fromUserInfo?.birthDate,
      street: fromClaims.street ?? fromUserInfo?.street,
      houseNumber: fromClaims.houseNumber ?? fromUserInfo?.houseNumber,
      postalCode: fromClaims.postalCode ?? fromUserInfo?.postalCode,
      city: fromClaims.city ?? fromUserInfo?.city,
      groups,
      role: this.mapRoleClaim(
        typeof payload.role === 'string' ? payload.role : undefined,
      ),
    };
  }

  private getAuthMode(): AuthMode {
    const rawMode = this.config.get<string>('AUTH_MODE');
    if (rawMode === 'dev' || rawMode === 'oidc') return rawMode;
    const nodeEnv = this.config.get<string>('NODE_ENV');
    return nodeEnv === 'production' ? 'oidc' : 'dev';
  }

  private getJwks(issuer: string) {
    const configuredJwks = this.getConfig(
      'AUTHENTIK_OIDC_JWKS_URL',
      'AUTHENTIK_JWKS_URL',
    );
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
    const raw = Number(
      this.getConfig('AUTHENTIK_OIDC_JWKS_TIMEOUT_MS', 'AUTH_JWKS_TIMEOUT_MS') ??
        '5000',
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }

  private getClockToleranceSeconds(): number {
    const raw = Number(
      this.getConfig(
        'AUTHENTIK_OIDC_CLOCK_TOLERANCE_SEC',
        'AUTH_CLOCK_TOLERANCE_SEC',
      ) ?? '0',
    );
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }

  private isUserInfoFallbackEnabled(): boolean {
    const raw = this.getConfig(
      'AUTHENTIK_OIDC_ENABLE_USERINFO_FALLBACK',
      'AUTHENTIK_ENABLE_USERINFO_FALLBACK',
    );
    if (!raw) return false;
    return raw.toLowerCase() === 'true';
  }

  private getConfig(...keys: string[]) {
    for (const key of keys) {
      const value = this.config.get<string>(key)?.trim();
      if (value) return value;
    }
    return undefined;
  }

  private ensureSecureIssuer(issuer: string) {
    try {
      const url = new URL(issuer);
      const isLocalhost =
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1';
      if (url.protocol !== 'https:' && !isLocalhost) {
        throw new UnauthorizedException(
          'OIDC Issuer muss HTTPS verwenden (ausser localhost)',
        );
      }
    } catch {
      throw new UnauthorizedException('OIDC Issuer URL ist ungueltig');
    }
  }

  private getAcceptedIssuers(issuer: string): string[] {
    const trimmed = issuer.replace(/\/+$/, '');
    const withTrailingSlash = `${trimmed}/`;
    if (trimmed === issuer) return [issuer, withTrailingSlash];
    return [issuer, trimmed];
  }

  private shouldFetchUserInfoProfile(profile: {
    phone?: string;
    birthDate?: string;
    street?: string;
    houseNumber?: string;
    postalCode?: string;
    city?: string;
  }) {
    return (
      !profile.phone ||
      !profile.birthDate ||
      !profile.street ||
      !profile.houseNumber ||
      !profile.postalCode ||
      !profile.city
    );
  }

  private extractProfileClaims(payload: JWTPayload) {
    const address =
      payload.address && typeof payload.address === 'object'
        ? (payload.address as Record<string, unknown>)
        : undefined;
    const streetAddress =
      this.pickString(payload, ['street_address']) ??
      this.pickString(address, ['street_address']);
    const parsedAddress = this.splitStreetAndHouseNumber(streetAddress);
    return {
      phone: this.pickString(payload, ['phone_number', 'phone']),
      birthDate: this.pickString(payload, ['birthdate', 'birthday']),
      street:
        parsedAddress.street ??
        this.pickString(payload, ['street']) ??
        this.pickString(address, ['street']),
      houseNumber:
        parsedAddress.houseNumber ??
        this.pickString(payload, ['house_number', 'house-number']) ??
        this.pickString(address, ['house_number', 'house-number']),
      postalCode:
        this.pickString(payload, ['postal_code', 'zipcode']) ??
        this.pickString(address, ['postal_code', 'zipcode']),
      city:
        this.pickString(payload, ['city', 'locality', 'town']) ??
        this.pickString(address, ['city', 'locality', 'town']),
    };
  }

  private pickString(source: Record<string, unknown> | undefined, keys: string[]) {
    if (!source) return undefined;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private splitStreetAndHouseNumber(streetAddress?: string) {
    if (!streetAddress) return { street: undefined, houseNumber: undefined };
    const normalized = streetAddress.trim();
    if (!normalized) return { street: undefined, houseNumber: undefined };
    const match = normalized.match(/^(.*?)[,\s]+(\d+[a-zA-Z\-\/]*)$/);
    if (!match) return { street: normalized, houseNumber: undefined };
    return {
      street: match[1]?.trim() || undefined,
      houseNumber: match[2]?.trim() || undefined,
    };
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
      if (error.name === 'JWTClaimValidationFailed')
        return 'Token Claim Validierung fehlgeschlagen';
      if (error.name === 'JWSSignatureVerificationFailed')
        return 'Token Signatur ungueltig';
    }
    return 'Ungueltiger Bearer Token';
  }

  private logAuth(
    event: string,
    req: RequestWithUser,
    sub?: string,
    reason?: string,
  ) {
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
