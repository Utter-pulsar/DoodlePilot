// Minimal promise-based tween manager. OverlayApp pumps `tweens.update(dtMs)`
// once per frame; entities `await tweens.to(sprite, { x, y }, ms)`.

export type Easing = (t: number) => number

export const linear: Easing = (t) => t
export const easeOut: Easing = (t) => 1 - Math.pow(1 - t, 3)
export const easeIn: Easing = (t) => t * t * t
export const easeInOut: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface ActiveTween {
  target: Record<string, number>
  keys: string[]
  from: number[]
  to: number[]
  dur: number
  elapsed: number
  ease: Easing
  resolve: () => void
}

class TweenManager {
  private active: ActiveTween[] = []

  to(
    target: object,
    props: Record<string, number>,
    dur: number,
    ease: Easing = easeOut
  ): Promise<void> {
    const t = target as Record<string, number>
    const keys = Object.keys(props)
    return new Promise((resolve) => {
      this.active.push({
        target: t,
        keys,
        from: keys.map((k) => t[k]),
        to: keys.map((k) => props[k]),
        dur,
        elapsed: 0,
        ease,
        resolve
      })
    })
  }

  update(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tw = this.active[i]
      tw.elapsed += dtMs
      const t = Math.min(1, tw.elapsed / tw.dur)
      const e = tw.ease(t)
      tw.keys.forEach((k, idx) => {
        tw.target[k] = tw.from[idx] + (tw.to[idx] - tw.from[idx]) * e
      })
      if (t >= 1) {
        this.active.splice(i, 1)
        tw.resolve()
      }
    }
  }

  /** Drop every tween targeting `target`, resolving each so an awaiting caller can finish. */
  cancel(target: object): void {
    const t = target as Record<string, number>
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].target === t) {
        const tw = this.active[i]
        this.active.splice(i, 1)
        tw.resolve()
      }
    }
  }

  clear(): void {
    this.active = []
  }
}

export const tweens = new TweenManager()
export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
