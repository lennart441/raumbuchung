import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'RATE_LIMIT_BOOKING_MAX') return '3';
      if (key === 'RATE_LIMIT_BOOKING_WINDOW_MS') return '60000';
      return undefined;
    }),
  } as unknown as ConfigService;

  it('allows requests up to the limit', () => {
    const service = new RateLimitService(config);
    expect(service.tryConsume('user-a', 'booking')).toBe(true);
    expect(service.tryConsume('user-a', 'booking')).toBe(true);
    expect(service.tryConsume('user-a', 'booking')).toBe(true);
  });

  it('blocks when limit exceeded for the same user', () => {
    const service = new RateLimitService(config);
    service.tryConsume('user-b', 'booking');
    service.tryConsume('user-b', 'booking');
    service.tryConsume('user-b', 'booking');
    expect(service.tryConsume('user-b', 'booking')).toBe(false);
  });

  it('tracks users independently', () => {
    const service = new RateLimitService(config);
    service.tryConsume('user-c', 'booking');
    service.tryConsume('user-c', 'booking');
    service.tryConsume('user-c', 'booking');
    expect(service.tryConsume('user-d', 'booking')).toBe(true);
  });
});
