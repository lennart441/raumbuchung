import { UserRole } from '@prisma/client';

const roleMap: Record<string, UserRole> = {
  ADMIN: UserRole.ADMIN,
  EXTENDED: UserRole.EXTENDED_USER,
  EXTENDED_USER: UserRole.EXTENDED_USER,
  USER: UserRole.USER,
};

const groupMap: Record<string, UserRole> = {
  admin: UserRole.ADMIN,
  raumbuchung_admin: UserRole.ADMIN,
  extended: UserRole.EXTENDED_USER,
  extended_user: UserRole.EXTENDED_USER,
  raumbuchung_extended: UserRole.EXTENDED_USER,
  user: UserRole.USER,
  raumbuchung_user: UserRole.USER,
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
  for (const groupName of groupList) {
    const normalizedGroup = groupName.toLowerCase();
    if (groupMap[normalizedGroup] === UserRole.ADMIN) return UserRole.ADMIN;
  }
  for (const groupName of groupList) {
    const normalizedGroup = groupName.toLowerCase();
    if (groupMap[normalizedGroup] === UserRole.EXTENDED_USER) {
      return UserRole.EXTENDED_USER;
    }
  }
  return UserRole.USER;
}
