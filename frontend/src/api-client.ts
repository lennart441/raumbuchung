import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { getApiBaseUrl } from './api-base'
import { getAccessToken, refreshAccessToken } from './auth/auth-service'

type RetryConfig = InternalAxiosRequestConfig & { _authRetry?: boolean }

export const api = axios.create({
  baseURL: getApiBaseUrl(),
})

let devAuthHeadersProvider: () => Record<string, string> = () => ({})

export function setDevAuthHeadersProvider(provider: () => Record<string, string>) {
  devAuthHeadersProvider = provider
}

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
    return config
  }
  for (const [key, value] of Object.entries(devAuthHeadersProvider())) {
    config.headers.set(key, value)
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined
    if (!config || error.response?.status !== 401 || config._authRetry) {
      return Promise.reject(error)
    }
    if (devAuthHeadersProvider()['x-dev-role']) {
      return Promise.reject(error)
    }
    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      return Promise.reject(error)
    }
    config._authRetry = true
    config.headers.set('Authorization', `Bearer ${refreshed}`)
    return api.request(config)
  },
)
