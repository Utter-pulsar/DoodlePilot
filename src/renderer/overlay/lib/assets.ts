import { Assets, Rectangle, Texture } from 'pixi.js'

// Static URL imports (Vite resolves @assets -> project-root assets/). Pixel art => NEAREST.
import planeFlyUrl from '@assets/sprites/plane/plane-fly.png'
import planeUrl from '@assets/sprites/plane/plane.png'

export interface SpriteStore {
  ready: boolean
  planeFly: Texture[] // 4x2 = 8 frames (center-pinned, propeller spin)
  plane: Texture | null // single fallback
}

export const sprites: SpriteStore = {
  ready: false,
  planeFly: [],
  plane: null
}

async function load(url: string): Promise<Texture | null> {
  try {
    const tex = (await Assets.load(url)) as Texture
    tex.source.scaleMode = 'nearest' // crisp pixels, no smoothing
    return tex
  } catch {
    return null
  }
}

/** Slice a sheet texture into a row-major array of frame textures. */
function slice(base: Texture | null, cols: number, rows: number): Texture[] {
  if (!base) return []
  const fw = Math.floor(base.width / cols)
  const fh = Math.floor(base.height / rows)
  const frames: Texture[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      frames.push(new Texture({ source: base.source, frame: new Rectangle(c * fw, r * fh, fw, fh) }))
    }
  }
  return frames
}

export async function loadSprites(): Promise<void> {
  const [planeFly, plane] = await Promise.all([load(planeFlyUrl), load(planeUrl)])
  sprites.planeFly = slice(planeFly, 4, 2)
  sprites.plane = plane
  sprites.ready = true
}
