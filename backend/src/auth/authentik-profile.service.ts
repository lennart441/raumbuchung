import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_PHONE_KEYS,
  DEFAULT_POSTAL_KEYS,
  pickClaimString,
} from './profile-claim.util';

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

  private phoneClaimKeys(): string[] {
    const custom =
      this.config.get<string>('AUTHENTIK_CLAIM_PHONE')?.trim() ||
      this.config.get<string>('AUTH_CLAIM_PHONE')?.trim();
    return custom ? [custom, ...DEFAULT_PHONE_KEYS] : [...DEFAULT_PHONE_KEYS];
  }

  private postalClaimKeys(): string[] {
    const custom =
      this.config.get<string>('AUTHENTIK_CLAIM_POSTAL_CODE')?.trim() ||
      this.config.get<string>('AUTH_CLAIM_POSTAL_CODE')?.trim();
    return custom
      ? [custom, ...DEFAULT_POSTAL_KEYS]
      : [...DEFAULT_POSTAL_KEYS];
  }

  private extractProfile(payload: UserInfoPayload): AuthentikProfile {
    const address =
      payload.address && typeof payload.address === 'object'
        ? (payload.address as Record<string, unknown>)
        : undefined;
    const attributes =
      payload.attributes && typeof payload.attributes === 'object'
        ? (payload.attributes as Record<string, unknown>)
        : undefined;

    const phoneKeys = this.phoneClaimKeys();
    const postalKeys = this.postalClaimKeys();

    const streetAddress =
      pickClaimString(payload, ['street_address']) ??
      pickClaimString(attributes, ['street_address']) ??
      pickClaimString(address, ['street_address']);
    const parsedAddress = this.splitStreetAndHouseNumber(streetAddress);

    return {
      phone:
        pickClaimString(payload, phoneKeys) ??
        pickClaimString(attributes, phoneKeys),
      birthDate:
        pickClaimString(payload, ['birthdate', 'birthday']) ??
        pickClaimString(attributes, ['birthdate', 'birthday']),
      street:
        parsedAddress.street ??
        pickClaimString(payload, ['street']) ??
        pickClaimString(attributes, ['street']) ??
        pickClaimString(address, ['street']),
      houseNumber:
        parsedAddress.houseNumber ??
        pickClaimString(payload, ['house_number', 'house-number']) ??
        pickClaimString(attributes, ['house_number', 'house-number']) ??
        pickClaimString(address, ['house_number', 'house-number']),
      postalCode:
        pickClaimString(payload, postalKeys) ??
        pickClaimString(attributes, postalKeys) ??
        pickClaimString(address, postalKeys),
      city:
        pickClaimString(payload, ['city', 'locality', 'town']) ??
        pickClaimString(attributes, ['city', 'locality', 'town']) ??
        pickClaimString(address, ['city', 'locality', 'town']),
    };
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
