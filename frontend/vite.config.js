import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.csv"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
