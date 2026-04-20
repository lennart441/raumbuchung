import { ConfigService } from '@nestjs/config';
import { AuthentikProfileService } from './authentik-profile.service';

describe('AuthentikProfileService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'AUTHENTIK_OIDC_USERINFO_URL') return '';
      if (key === 'AUTHENTIK_USERINFO_URL') return '';
      return undefined;
    }),
  } as unknown as ConfigService;

  let service: AuthentikProfileService;

  beforeEach(() => {
    service = new AuthentikProfileService(config);
    jest.clearAllMocks();
  });

  it('maps userinfo payload into profile fields', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          phone_number: '+49123456',
          birthdate: '1990-02-01',
          address: {
            street_address: 'Musterweg 12',
            postal_code: '12345',
            locality: 'Kiel',
          },
        }),
      } as Response;
    }) as typeof fetch;

    const profile = await service.fetchProfile(
      'access-token',
      'https://auth.example.com/application/o/raumbuchung',
    );

    expect(profile).toEqual({
      phone: '+49123456',
      birthDate: '1990-02-01',
      street: 'Musterweg',
      houseNumber: '12',
      postalCode: '12345',
      city: 'Kiel',
    });
  });

  it('returns undefined when userinfo request fails', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response;
    }) as typeof fetch;

    const profile = await service.fetchProfile(
      'access-token',
      'https://auth.example.com/application/o/raumbuchung',
    );

    expect(profile).toBeUndefined();
  });
});
