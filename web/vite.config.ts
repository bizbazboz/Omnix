import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "self-hosted-browser-runtimes",
      closeBundle() {
        const inference = resolve("dist/assistant/ort");
        mkdirSync(inference, { recursive: true });
        for (const name of readdirSync(
          resolve("node_modules/onnxruntime-web/dist")
        )) {
          if (
            /^ort-wasm-simd-threaded\.((asyncify|jspi)\.)?(mjs|wasm)$/.test(
              name
            )
          )
            copyFileSync(
              resolve("node_modules/onnxruntime-web/dist", name),
              resolve(inference, name)
            );
        }
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
          if (request.url?.startsWith("/assistant/ort/")) {
            const name = request.url
              .split("?")[0]
              .slice("/assistant/ort/".length);
            if (
              !/^ort-wasm-simd-threaded\.((asyncify|jspi)\.)?(mjs|wasm)$/.test(
                name
              )
            )
              return next();
            response.setHeader(
              "Content-Type",
              name.endsWith(".wasm") ? "application/wasm" : "text/javascript"
            );
            response.end(
              readFileSync(resolve("node_modules/onnxruntime-web/dist", name))
            );
            return;
          }
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
  worker: { format: "es" },
  build: { assetsInlineLimit: 0 },
  server: {
    allowedHosts: ["web", "localhost"],
    proxy: { "/api": "http://api:8000" }
  }
});
