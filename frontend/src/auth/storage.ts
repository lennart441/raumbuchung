import { Preferences } from '@capacitor/preferences'
import { WebStorageStateStore, type StateStore } from 'oidc-client-ts'
import { isNativeApp } from './platform'

const OIDC_PREFIX = 'oidc.'

class CapacitorPreferencesStateStore implements StateStore {
  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key: OIDC_PREFIX + key, value })
  }

  async get(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key: OIDC_PREFIX + key })
    return value ?? null
  }

  async remove(key: string): Promise<string | null> {
    const existing = await this.get(key)
    await Preferences.remove({ key: OIDC_PREFIX + key })
    return existing
  }

  async getAllKeys(): Promise<string[]> {
    const { keys } = await Preferences.keys()
    return keys.filter((k) => k.startsWith(OIDC_PREFIX)).map((k) => k.slice(OIDC_PREFIX.length))
  }
}

export function createOidcUserStore(): StateStore {
  if (isNativeApp()) {
    return new CapacitorPreferencesStateStore()
  }
  return new WebStorageStateStore({ store: window.localStorage })
}
