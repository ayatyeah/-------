import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Абсолютный адрес сайта для og:image и JSON-LD подставляется в index.html
   как %VITE_SITE_URL%. Vite берёт его из переменной VITE_SITE_URL; в Docker
   её значение приходит из build-arg SITE_URL (см. Dockerfile). Пустое
   значение оставляет относительные пути — как было до правки. Хвостовой слэш
   убираем, чтобы не получить `//assets`. */
process.env.VITE_SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || '').replace(/\/$/, '')

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // React с роутером меняются редко — отдельным чанком они остаются
        // в кеше браузера между релизами сайта.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
