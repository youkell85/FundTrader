import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: "/fund/",
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/|fund\/api\/).*$/] }),
    react(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React ecosystem
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'react-vendor';
          }
          // tRPC and query
          if (id.includes('@trpc') || id.includes('@tanstack/react-query') || id.includes('superjson')) {
            return 'trpc-vendor';
          }
          // Charts - split by library
          if (id.includes('recharts')) {
            return 'charts-vendor';
          }
          // Three.js - separate chunk (only loaded on 3D pages)
          if (id.includes('three') || id.includes('@react-three')) {
            return 'three-vendor';
          }
          // Framer Motion
          if (id.includes('framer-motion')) {
            return 'motion-vendor';
          }
          // Radix UI
          if (id.includes('@radix-ui')) {
            return 'radix-vendor';
          }
          // Utils
          if (id.includes('date-fns') || id.includes('zod') || id.includes('clsx') || id.includes('tailwind-merge')) {
            return 'utils-vendor';
          }
        },
      },
    },
    minify: "esbuild",
  },
});
