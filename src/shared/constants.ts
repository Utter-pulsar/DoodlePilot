export const APP_NAME = 'DoodlePilot'
export const DATA_FILE = 'doodlepilot.sqlite'

/** Hand-drawn marker palette. Referenced by select options and banners. */
export const DOODLE_PALETTE: Record<string, string> = {
  'marker-yellow': '#FFD23F',
  'marker-coral': '#FF6B6B',
  'marker-sky': '#4ECDC4',
  'marker-blue': '#5B8DEF',
  'marker-violet': '#9B6DFF',
  'marker-green': '#7BC950',
  'marker-pink': '#FF9FF3',
  'marker-ink': '#2B2B2B',
  'paper': '#FBF7EF'
}

export const PALETTE_TOKENS = Object.keys(DOODLE_PALETTE)
