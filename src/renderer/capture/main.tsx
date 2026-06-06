import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CaptureApp } from './CaptureApp'
import '@app/styles/global.css'

// global.css paints the body paper-colored; the capture window must let the frozen frame show, so
// force the body transparent (inline beats the stylesheet). The full-window <img> covers it anyway.
document.body.style.background = 'transparent'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>
)
