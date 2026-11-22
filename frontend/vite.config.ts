import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Vendor estable en chunks separados: descarga paralela en el móvil
        // y caché entre deploys (los hashes de los vendors no cambian).
        codeSplitting: {
          groups: [
            {
              name: 'vite-preload',
              test: /preload-helper/,
              priority: 30,
            },
            {
              name: 'vendor-stellar-xdr',
              test: /node_modules\/(@stellar\/stellar-sdk\/lib\/esm\/xdr\/|@stellar\/js-xdr\/|js-xdr\/)/,
              priority: 25,
            },
            {
              name: 'vendor-stellar-base',
              test: /node_modules\/(@stellar\/stellar-sdk\/lib\/esm\/base\/|tweetnacl\/)/,
              priority: 20,
            },
            {
              name: 'vendor-stellar-sdk',
              test: /node_modules\/@stellar\//,
              priority: 15,
            },
            {
              name: 'vendor-kit',
              test: /node_modules\/@creit\.tech\//,
              priority: 15,
            },
            {
              name: 'vendor-react',
              test: /node_modules\/(react|react-dom|react-router|scheduler)\//,
              priority: 15,
            },
            {
              name: 'vendor-state',
              test: /node_modules\/(zustand|@tanstack)\//,
              priority: 15,
            },
            {
              name: 'contracts',
              test: /\/src\/contracts\//,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
