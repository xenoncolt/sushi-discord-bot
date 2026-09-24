import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// `npm run dev` proxies the API to a locally running bot (DASHBOARD_PORT).
export default defineConfig({
    plugins: [sveltekit()],
    server: {
        proxy: {
            "/api": { target: `http://localhost:${process.env.DASHBOARD_PORT ?? 3000}`, changeOrigin: false }
        }
    }
});
