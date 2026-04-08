export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  groups?: string[];
  role?: 'USER' | 'EXTENDED_USER' | 'ADMIN';
};
