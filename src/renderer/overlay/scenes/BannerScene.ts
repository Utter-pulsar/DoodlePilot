import { Container, Graphics } from 'pixi.js'
import { Plane } from '../entities/Plane'
import { Banner } from '../entities/Banner'
import { tweens, linear } from '../lib/anim'

const INK = 0x2b2b2b
const TOP = 44 // keep banners near the top
const LANE_STEP = 116
const LANE_GAP = 90 // a lane is reusable once the last banner's tail cleared this margin
const SPEED_PX_PER_S = 210

interface Run {
  banner: Banner
  group: Container
  rightEdge: () => number
}

/**
 * Plane flies RIGHT → LEFT across ALL screens (the overlay spans the display union),
 * towing a rippling hand-drawn banner behind it. Concurrent banners pick non-overlapping
 * lanes like Bilibili danmaku: close in time → different rows; far apart → reuse a row.
 */
export class BannerScene extends Container {
  private screenW = 0
  private screenH = 0
  private lanes: (Run | null)[] = []
  private active: Run[] = []

  resize(w: number, h: number): void {
    this.screenW = w
    this.screenH = h
  }

  /** Ripple every active banner each frame. */
  update(dtMs: number): void {
    for (const r of this.active) r.banner.update(dtMs)
  }

  /**
   * Drop every in-flight banner at once. Called when the overlay's rAF ticker resumes after a
   * long pause (display asleep / system suspended): banners that piled up while no frames were
   * drawn would otherwise ALL fly across together. Cancelling each fly-tween resolves its
   * awaiting `show()`, whose own cleanup then destroys the group and frees the lane.
   */
  clearAll(): void {
    for (const r of [...this.active]) tweens.cancel(r.group)
  }

  async show(text: string, brand = false): Promise<void> {
    const banner = new Banner(text, brand)
    const plane = new Plane()
    plane.scale.x = -1 // face LEFT (direction of travel)

    const group = new Container()
    banner.x = 170 + banner.bannerWidth / 2 // banner trails behind (to the plane's right)
    const line = new Graphics()
    line
      .moveTo(60, 0)
      .lineTo(banner.x - banner.bannerWidth / 2, 0)
      .stroke({ width: 2, color: INK })
    group.addChild(line)
    group.addChild(banner)
    group.addChild(plane)

    const lane = this.pickLane()
    group.y = TOP + lane * LANE_STEP

    // plane starts just off the right edge so it appears within ~0.5s (not 4s)
    const enterX = this.screenW + 110
    const exitX = -(banner.x + banner.bannerWidth / 2 + 80) // whole banner fully off the left
    group.x = enterX
    this.addChild(group)

    const run: Run = {
      banner,
      group,
      rightEdge: () => group.x + banner.x + banner.bannerWidth / 2
    }
    this.lanes[lane] = run
    this.active.push(run)

    const dur = ((enterX - exitX) / SPEED_PX_PER_S) * 1000
    await tweens.to(group, { x: exitX }, dur, linear)

    group.destroy({ children: true })
    this.active = this.active.filter((r) => r !== run)
    if (this.lanes[lane] === run) this.lanes[lane] = null
  }

  /** Lowest lane that is empty or whose last banner has fully entered (danmaku spacing). */
  private pickLane(): number {
    const maxLanes = Math.max(1, Math.min(5, Math.floor((this.screenH * 0.45) / LANE_STEP)))
    for (let i = 0; i < maxLanes; i++) {
      const r = this.lanes[i]
      if (!r || r.rightEdge() < this.screenW - LANE_GAP) return i
    }
    return 0 // all busy (rare): stack on the top lane
  }
}
