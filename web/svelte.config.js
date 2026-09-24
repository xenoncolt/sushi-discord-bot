import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Built as a single-page app. The bot serves web/build itself and answers
// every unknown path with index.html, so client-side routing takes over.
export default {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter({
            pages: "build",
            assets: "build",
            fallback: "index.html",
            precompress: true
        })
    }
};
