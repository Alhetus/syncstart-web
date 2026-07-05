import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules", "scores"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  }
];
