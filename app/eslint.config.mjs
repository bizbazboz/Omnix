import { fixupConfigRules } from "@eslint/compat";
import { defineConfig } from "eslint/config";
import expo from "eslint-config-expo/flat.js";
export default defineConfig([
  ...fixupConfigRules(expo),
  { ignores: ["build/**", "android/**", "ios/**", ".expo/**"] }
]);
