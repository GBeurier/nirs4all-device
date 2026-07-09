import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 4376,
    strictPort: false,
  },
  preview: {
    port: 4377,
    strictPort: false,
  },
  build: {
    target: "es2022",
  },
});
