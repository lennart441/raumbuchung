import { UserRole } from '@prisma/client';

const roleMap: Record<string, UserRole> = {
  ADMIN: UserRole.ADMIN,
  EXTENDED_USER: UserRole.EXTENDED_USER,
  USER: UserRole.USER,
};

export function resolveRoleFromClaims(
  role?: string,
  groups?: string[],
): UserRole {
  const normalizedRole = role?.toUpperCase();
  if (normalizedRole && roleMap[normalizedRole]) {
    return roleMap[normalizedRole];
  }

  const groupList = groups ?? [];
  if (groupList.includes('admin')) return UserRole.ADMIN;
  if (groupList.includes('extended_user')) return UserRole.EXTENDED_USER;
  return UserRole.USER;
}
