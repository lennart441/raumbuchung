import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type AuthentikProfile = {
  phone?: string;
  birthDate?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
};

type UserInfoPayload = Record<string, unknown>;

@Injectable()
export class AuthentikProfileService {
  private readonly logger = new Logger(AuthentikProfileService.name);

  constructor(private readonly config: ConfigService) {}

  async fetchProfile(accessToken: string, issuer: string) {
    const userInfoUrl = this.resolveUserInfoUrl(issuer);
    try {
      const response = await fetch(userInfoUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        this.logger.warn(
          `userinfo request failed: ${response.status} ${response.statusText}`,
        );
        return undefined;
      }
      const payload = (await response.json()) as UserInfoPayload;
      return this.extractProfile(payload);
    } catch (error) {
      this.logger.warn(
        `userinfo request failed with exception: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return undefined;
    }
  }

  private resolveUserInfoUrl(issuer: string) {
    const configured =
      this.config.get<string>('AUTHENTIK_OIDC_USERINFO_URL')?.trim() ||
      this.config.get<string>('AUTHENTIK_USERINFO_URL')?.trim();
    if (configured) return configured;
    return `${issuer.replace(/\/+$/, '')}/userinfo/`;
  }

  private extractProfile(payload: UserInfoPayload): AuthentikProfile {
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
}
