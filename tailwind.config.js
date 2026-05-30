/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Excalifont for Latin; Xiaolai (小赖) for Chinese (per-glyph fallback);
        // then other hand-drawn faces as a safety net.
        doodle: [
          'Excalifont',
          'Xiaolai',
          '"Patrick Hand"',
          '"Kalam"',
          '"Comic Sans MS"',
          'cursive',
          'sans-serif'
        ]
      },
      colors: {
        // theme-aware tokens (CSS vars in global.css; `/<alpha>` supported)
        paper: 'rgb(var(--paper) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        // marker accents stay vivid in both themes
        marker: {
          yellow: '#FFD23F',
          coral: '#FF6B6B',
          sky: '#4ECDC4',
          blue: '#5B8DEF',
          violet: '#9B6DFF',
          green: '#7BC950',
          pink: '#FF9FF3'
        }
      },
      boxShadow: {
        doodle: '3px 3px 0 0 var(--shadow)'
      }
    }
  },
  plugins: []
}
