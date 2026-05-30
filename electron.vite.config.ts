import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// DoodlePilot uses three build targets:
//   main     -> Electron main process (window mgmt, scheduler, persistence, services)
//   preload  -> contextBridge API exposed to both renderer windows
//   renderer -> TWO html entries: `app` (hand-drawn UI) and `overlay` (PixiJS desktop layer)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@app': resolve('src/renderer/app'),
        '@overlay': resolve('src/renderer/overlay'),
        '@assets': resolve('assets')
      }
    },
    // allow the dev server to read sprite PNGs from the project-root assets/ dir
    server: { fs: { allow: [resolve('.')] } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          app: resolve('src/renderer/app/index.html'),
          overlay: resolve('src/renderer/overlay/index.html')
        }
      }
    }
  }
})
