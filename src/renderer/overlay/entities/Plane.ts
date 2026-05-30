import { AnimatedSprite, Container, Graphics, Sprite } from 'pixi.js'
import { sprites } from '../lib/assets'

const INK = 0x2b2b2b
const SCALE = 0.5 // 360x200 cell

/** Banner-towing plane (nose right; BannerScene flips it to face the travel direction). */
export class Plane extends Container {
  constructor() {
    super()
    if (sprites.planeFly.length) {
      const a = new AnimatedSprite(sprites.planeFly)
      a.anchor.set(0.5, 0.5) // center pinned; only the propeller spins
      a.scale.set(SCALE)
      a.animationSpeed = 0.25
      a.play()
      this.addChild(a)
    } else if (sprites.plane) {
      const s = new Sprite(sprites.plane)
      s.anchor.set(0.5, 0.5)
      s.scale.set(SCALE)
      this.addChild(s)
    } else {
      const g = new Graphics()
      g.ellipse(0, 0, 36, 14).fill('#4ECDC4').stroke({ width: 3, color: INK })
      g.moveTo(-6, -2).lineTo(10, -24).lineTo(18, -2).fill('#FFD23F').stroke({ width: 3, color: INK })
      g.moveTo(-32, 0).lineTo(-46, -14).lineTo(-30, -4).fill('#FF6B6B').stroke({ width: 3, color: INK })
      g.circle(30, -1, 4).fill('#FBF7EF').stroke({ width: 2, color: INK })
      this.addChild(g)
    }
  }
}
