import type { Id } from './common'

/** A banner to be pulled across the screen by the plane (the alarm reminder). */
export interface BannerView {
  id: Id
  text: string
  /** total flight duration; if omitted the overlay derives it from screen width + speed */
  durationMs?: number
  /** pixels per second; the overlay also auto-fits banner WIDTH to the text length */
  speed?: number
  /** hand-drawn palette token for the cloth */
  color?: string
  /** show the app's spiral logo on the cloth (preview banners only, not real alarms) */
  brand?: boolean
}

/** Geometry of the overlay window relative to its own origin (spans all displays). */
export interface OverlayLayout {
  /** total overlay size = union of all displays */
  width: number
  height: number
  /** primary display rectangle, relative to the overlay (union) origin */
  primary: { x: number; y: number; width: number; height: number }
}
