import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "self-hosted-python-runtime",
      closeBundle() {
        const target = resolve("dist/notebook/python");
        mkdirSync(target, { recursive: true });
        for (const name of [
          "pyodide.mjs",
          "pyodide.js",
          "pyodide.asm.js",
          "pyodide.asm.wasm",
          "python_stdlib.zip",
          "pyodide-lock.json"
        ])
          copyFileSync(
            resolve("node_modules/pyodide", name),
            resolve(target, name)
          );
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const name = request.url
            ?.split("?")[0]
            ?.replace("/notebook/python/", "");
          if (
            !request.url?.startsWith("/notebook/python/") ||
            ![
              "pyodide.mjs",
              "pyodide.js",
              "pyodide.asm.js",
              "pyodide.asm.wasm",
              "python_stdlib.zip",
              "pyodide-lock.json"
            ].includes(name || "")
          )
            return next();
          response.setHeader("Access-Control-Allow-Origin", "*");
          response.setHeader(
            "Content-Type",
            name!.endsWith(".mjs") || name!.endsWith(".js")
              ? "text/javascript"
              : name!.endsWith(".wasm")
                ? "application/wasm"
                : "application/octet-stream"
          );
          response.end(readFileSync(resolve("node_modules/pyodide", name!)));
        });
      }
    }
  ],
  build: { assetsInlineLimit: 0 },
  server: {
    allowedHosts: ["web", "localhost"],
    proxy: { "/api": "http://api:8000" }
  }
});
