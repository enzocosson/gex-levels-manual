import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/gexbot": {
        target: "https://api.gexbot.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/gexbot/, ""),
      },
    },
  },
});
