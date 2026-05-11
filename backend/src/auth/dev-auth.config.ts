import { ConfigService } from '@nestjs/config';

/** True when mock auth (DEV=true) is enabled; otherwise OIDC is required. */
export function isDevAuthEnabled(config: ConfigService): boolean {
  const raw = config.get<string>('DEV')?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return false;
}
