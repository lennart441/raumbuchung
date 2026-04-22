import { UserRole } from '@prisma/client';
import { resolveRoleFromClaims } from './role-resolution';

describe('resolveRoleFromClaims', () => {
  it('prefers explicit role claim when valid', () => {
    expect(resolveRoleFromClaims('ADMIN', ['extended_user'])).toBe(
      UserRole.ADMIN,
    );
    expect(resolveRoleFromClaims('extended', ['admin'])).toBe(
      UserRole.EXTENDED_USER,
    );
    expect(resolveRoleFromClaims('extended_user', ['admin'])).toBe(
      UserRole.EXTENDED_USER,
    );
  });

  it('falls back to groups when role claim missing', () => {
    expect(resolveRoleFromClaims(undefined, ['admin'])).toBe(UserRole.ADMIN);
    expect(resolveRoleFromClaims(undefined, [' authentik Admins '])).toBe(
      UserRole.ADMIN,
    );
    expect(resolveRoleFromClaims(undefined, ['raumbuchung_admin'])).toBe(
      UserRole.ADMIN,
    );
    expect(resolveRoleFromClaims(undefined, ['extended_user'])).toBe(
      UserRole.EXTENDED_USER,
    );
    expect(resolveRoleFromClaims(undefined, ['raumbuchung_extended'])).toBe(
      UserRole.EXTENDED_USER,
    );
  });

  it('defaults to user when no strong claim exists', () => {
    expect(resolveRoleFromClaims('unknown', ['other'])).toBe(UserRole.USER);
    expect(resolveRoleFromClaims(undefined, undefined)).toBe(UserRole.USER);
  });
});
