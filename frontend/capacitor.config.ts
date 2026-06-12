import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'de.stocksee.raumbuchung',
  appName: 'Raumbuchung Stocksee',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
