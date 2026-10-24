import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite plugin that injects a strict Content Security Policy into the HTML head during production builds.
 * Note: Only applied during build (`apply: 'build'`). In dev mode, Vite requires inline scripts
 * and WebSocket connections for Hot Module Replacement (HMR).
 */
function argusCsp() {
  return {
    name: 'argus-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';",
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), argusCsp()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
})
