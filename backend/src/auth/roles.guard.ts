import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { AuthUser } from './request-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Nicht eingeloggt');

    const role = user.role ?? this.mapGroupsToRole(user.groups);
    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('Keine Berechtigung');
    }
    return true;
  }

  private mapGroupsToRole(groups?: string[]): UserRole {
    if ((groups ?? []).includes('admin')) return UserRole.ADMIN;
    if ((groups ?? []).includes('extended_user')) return UserRole.EXTENDED_USER;
    return UserRole.USER;
  }
}
