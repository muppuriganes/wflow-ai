/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Share the repo-root .env (only VITE_* variables reach the browser).
  envDir: "..",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely: separate chunks stay cached across app releases.
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          ui: ["radix-ui", "sonner", "lucide-react"],
          forms: ["zod", "react-hook-form", "@hookform/resolvers"],
          query: ["@tanstack/react-query"],
          flow: ["@xyflow/react"],
        },
      },
    },
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
