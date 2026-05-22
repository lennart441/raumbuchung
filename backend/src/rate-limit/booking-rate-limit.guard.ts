import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AuthUser } from '../auth/request-user';
import { RateLimitService } from './rate-limit.service';

type RequestWithUser = { user?: AuthUser };

@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  private static readonly NAMESPACE = 'booking';

  constructor(private readonly rateLimit: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const sub = req.user?.sub;
    if (!sub) return true;

    if (!this.rateLimit.tryConsume(sub, BookingRateLimitGuard.NAMESPACE)) {
      throw new HttpException(
        'Zu viele Buchungsanfragen. Bitte später erneut versuchen.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
