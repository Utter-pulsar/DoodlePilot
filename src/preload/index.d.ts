import type { DoodleApi } from '@shared/api/contract'

declare global {
  interface Window {
    api: DoodleApi
    platform: string
  }
}

export {}
