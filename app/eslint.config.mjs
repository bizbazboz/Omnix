import { defineConfig } from "eslint/config";
import expo from "eslint-config-expo/flat.js";
export default defineConfig([
  ...expo,
  { ignores: ["build/**", "android/**", "ios/**", ".expo/**"] }
]);
