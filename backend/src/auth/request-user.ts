export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  phone?: string;
  birthDate?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  groups?: string[];
  role?: 'USER' | 'EXTENDED_USER' | 'ADMIN';
};
