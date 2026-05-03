export const DEFAULT_PHONE_KEYS = [
  'phone_number',
  'phone',
  'Telefonnummer',
  'telefonnummer',
  'mobile',
  'tel',
  'phoneNumber',
];

export const DEFAULT_POSTAL_KEYS = [
  'postal_code',
  'zipcode',
  'PLZ',
  'zip',
  'ZipCode',
  'postalCode',
];

export function pickClaimString(
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim().length > 0) {
          return item.trim();
        }
      }
    }
  }
  return undefined;
}
