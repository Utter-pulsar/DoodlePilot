import { Container, MeshRope, Point, Texture } from 'pixi.js'
import rough from 'roughjs'
import logoUrl from '@assets/logo.png'

const INK = '#2B2B2B'
const PAPER = '#FBF7EF'
const PAD_X = 28
const PAD_Y = 14
const MARGIN = 12
const SHADOW_DX = 5
const SHADOW_DY = 6
const NOTCH = 20 // swallowtail depth on the free (right) end
const SEG = 20 // rope segments
const FONT = '26px Excalifont, Xiaolai, "Patrick Hand", sans-serif'
const ICON = 30 // the orange spiral brand mark baked on the towed end of the cloth
const ICON_GAP = 10

// Preloaded once when the overlay bundle loads, so it's ready by the time any banner shows.
const logoImg = new Image()
logoImg.src = logoUrl

/**
 * A hand-drawn (Rough.js) flag/pennant with a swallowtail end, a hand-drawn shadow,
 * and the message baked into the cloth. Rendered on a Pixi MeshRope so it ripples in
 * the wind (the free end waves more than the towed end). Stretches to fit the text.
 */
export class Banner extends Container {
  readonly bannerWidth: number
  private points: Point[] = []
  private amp: number[] = []
  private elapsed = 0

  constructor(text: string, brand = false) {
    super()

    // measure text
    const meas = document.createElement('canvas').getContext('2d')!
    meas.font = FONT
    const textW = Math.ceil(meas.measureText(text).width)

    // the spiral logo is a brand mark for PREVIEW banners only; real alarms stay text-only
    const hasLogo = brand && logoImg.complete && logoImg.naturalWidth > 0
    const iconW = hasLogo ? ICON + ICON_GAP : 0
    const boxW = iconW + textW + PAD_X * 2 + NOTCH
    const boxH = 30 + PAD_Y * 2
    const canvasW = boxW + MARGIN * 2 + SHADOW_DX
    const canvasH = boxH + MARGIN * 2 + SHADOW_DY

    const canvas = document.createElement('canvas')
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')!
    const rc = rough.canvas(canvas)

    const bx = MARGIN
    const by = MARGIN
    const flag = (ox: number, oy: number): [number, number][] => [
      [bx + ox, by + oy],
      [bx + boxW + ox, by + oy],
      [bx + boxW - NOTCH + ox, by + boxH / 2 + oy], // swallowtail notch (free end)
      [bx + boxW + ox, by + boxH + oy],
      [bx + ox, by + boxH + oy]
    ]

    // hand-drawn shadow (offset, translucent ink)
    rc.polygon(flag(SHADOW_DX, SHADOW_DY), {
      seed: 7,
      roughness: 1.5,
      stroke: 'rgba(43,43,43,0.28)',
      strokeWidth: 1.5,
      fill: 'rgba(43,43,43,0.16)',
      fillStyle: 'solid'
    })
    // main flag
    rc.polygon(flag(0, 0), {
      seed: 7,
      roughness: 1.3,
      stroke: INK,
      strokeWidth: 2.5,
      fill: PAPER,
      fillStyle: 'solid'
    })

    // bake the spiral brand mark (towed end) + message into the cloth (so they ripple together)
    if (hasLogo) {
      ctx.drawImage(logoImg, bx + PAD_X, by + boxH / 2 - ICON / 2, ICON, ICON)
    }
    ctx.font = FONT
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, bx + PAD_X + iconW, by + boxH / 2)

    const texture = Texture.from(canvas)
    texture.source.scaleMode = 'linear' // hand-drawn lines look better smoothed

    // rope spine across the width, centered at the container origin
    for (let i = 0; i <= SEG; i++) {
      this.points.push(new Point(-canvasW / 2 + (canvasW * i) / SEG, 0))
      this.amp.push(i / SEG) // 0 at towed (left) end, 1 at free (right) end
    }
    const rope = new MeshRope({ texture, points: this.points })
    rope.autoUpdate = true
    this.addChild(rope)

    this.bannerWidth = canvasW
  }

  /** Ripple the flag — bigger waves toward the free end. */
  update(dtMs: number): void {
    this.elapsed += dtMs
    const t = this.elapsed / 1000
    for (let i = 0; i < this.points.length; i++) {
      // wave travels toward the FREE (right) end — the plane flies left, banner streams right
      this.points[i].y = Math.sin(t * 3 - i * 0.4) * 4 * this.amp[i]
    }
  }
}
