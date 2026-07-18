import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative base so the build works from any hosting path (e.g. GitHub Pages project sites)
  base: "./",
  plugins: [react()],
  server: { port: 5180, host: true },
});
