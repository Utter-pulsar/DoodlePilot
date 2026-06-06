import { Application, Ticker } from 'pixi.js'
import type { OverlayLayout } from '@shared/types/overlay'
import { tweens } from './lib/anim'
import { loadSprites, sprites } from './lib/assets'
import { BannerScene } from './scenes/BannerScene'
import { api } from './lib/bridge'

export class OverlayApp {
  private readonly app = new Application()
  private readonly bannerScene = new BannerScene()
  private displayLayout: OverlayLayout | null = null

  async start(): Promise<void> {
    await this.app.init({
      backgroundAlpha: 0, // transparent — desktop shows through
      // explicit fixed size (NOT resizeTo:window) — auto-resize on a transparent
      // always-on-top window can fire spuriously and make the whole canvas jitter
      width: window.innerWidth,
      height: window.innerHeight,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    })
    document.body.appendChild(this.app.canvas)
    Ticker.shared.start() // drive AnimatedSprite autoUpdate (plane propeller)
    console.log(`[overlay] pixi ready renderer=${this.app.renderer.type} size=${window.innerWidth}x${window.innerHeight}`)

    // best-effort: wait for the hand-drawn fonts so Pixi text uses them
    // (Excalifont for Latin, Xiaolai for Chinese); falls back if absent
    await Promise.all([
      document.fonts.load('20px Excalifont'),
      document.fonts.load('20px Xiaolai')
    ]).catch(() => undefined)

    // load the pixel-art sprites (Graphics fallbacks kick in if any fail)
    await loadSprites().catch((e) => console.log('[overlay] loadSprites failed', String(e)))
    console.log(`[overlay] sprites ready=${sprites.ready} planeFly=${sprites.planeFly.length}`)

    this.app.stage.addChild(this.bannerScene)

    // multi-display geometry: overlay spans all screens; the banner flies across them
    this.displayLayout = await api.query('overlay.layout', undefined)
    console.log(`[overlay] layout ${this.displayLayout.width}x${this.displayLayout.height} primary=${JSON.stringify(this.displayLayout.primary)}`)
    this.applyLayout()
    window.addEventListener('resize', () => {
      // only react to a REAL size change (avoids per-frame resize jitter); app.screen is in CSS px
      if (this.app.screen.width === window.innerWidth && this.app.screen.height === window.innerHeight) {
        return
      }
      this.app.renderer.resize(window.innerWidth, window.innerHeight)
      this.applyLayout()
    })

    // The ticker is rAF-driven, so it PAUSES whenever the OS stops painting this window — the
    // display sleeping, the monitor turning off, or the machine suspending. Meanwhile alarm
    // banners keep arriving over IPC and queue up motionless at their entry point. Without this
    // guard they'd all release together the instant you wake the screen ("come back, jiggle the
    // mouse, and a day's worth of reminders fly past at once"). A big wall-clock gap between
    // frames means we just resumed from such a pause → drop the whole backlog instead.
    let lastTickWall = Date.now()
    const RESUME_GAP_MS = 4000
    this.app.ticker.add((ticker: Ticker) => {
      const wall = Date.now()
      const gap = wall - lastTickWall
      lastTickWall = wall
      if (gap > RESUME_GAP_MS) {
        this.bannerScene.clearAll()
        return
      }
      tweens.update(ticker.deltaMS)
      this.bannerScene.update(ticker.deltaMS)
    })

    // The banner is purely decorative and flies over everything — the overlay window
    // stays fully click-through (it was created with setIgnoreMouseEvents(true)), so we
    // never toggle interactivity here.

    api.on('overlay.banner', (b) => void this.bannerScene.show(b.text, b.brand))
  }

  private applyLayout(): void {
    const L = this.displayLayout
    if (!L) return
    this.bannerScene.resize(L.width, L.height) // banner spans all screens
  }
}
