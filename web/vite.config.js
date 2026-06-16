import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Frontend dev server proxies API, WebSocket, and Twilio webhook to the Fastify
// backend on :4000 so `npm run dev` here behaves exactly like the served build.
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "dist",
        emptyOutDir: true
    },
    server: {
        port: 5173,
        proxy: {
            "/api": { target: "http://localhost:4000", changeOrigin: true },
            "/twilio": { target: "http://localhost:4000", changeOrigin: true },
            "/healthz": { target: "http://localhost:4000", changeOrigin: true },
            "/ws": { target: "ws://localhost:4000", ws: true }
        }
    }
});
