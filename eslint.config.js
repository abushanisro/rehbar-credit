// eslint.config.js

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Ignore generated/build folders
  {
    ignores: [
      "dist",
      "build",
      "coverage",
      "node_modules",
      "*.min.js",
    ],
  },

  // Base JavaScript + TypeScript recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",

      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },

      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      import: importPlugin,
      "unused-imports": unusedImports,
    },

    settings: {
      react: {
        version: "detect",
      },

      "import/resolver": {
        typescript: true,
      },
    },

    rules: {
      /*
       |--------------------------------------------------------------------------
       | React Hooks
       |--------------------------------------------------------------------------
       */

      ...reactHooks.configs.recommended.rules,

      /*
       |--------------------------------------------------------------------------
       | React Fast Refresh
       |--------------------------------------------------------------------------
       */

      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],

      /*
       |--------------------------------------------------------------------------
       | TypeScript Best Practices
       |--------------------------------------------------------------------------
       */

      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],

      "@typescript-eslint/no-unused-vars": "off",

      "@typescript-eslint/no-explicit-any": "warn",

      "@typescript-eslint/explicit-function-return-type": "off",

      "@typescript-eslint/no-floating-promises": "error",

      "@typescript-eslint/no-misused-promises": "error",

      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-ignore": "allow-with-description",
        },
      ],

      /*
       |--------------------------------------------------------------------------
       | Imports
       |--------------------------------------------------------------------------
       */

      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "type",
          ],

          "newlines-between": "always",

          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      "import/no-duplicates": "warn",

      /*
       |--------------------------------------------------------------------------
       | Unused Imports
       |--------------------------------------------------------------------------
       */

      "unused-imports/no-unused-imports": "error",

      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      /*
       |--------------------------------------------------------------------------
       | General Code Quality
       |--------------------------------------------------------------------------
       */

      eqeqeq: ["error", "always"],

      curly: ["error", "all"],

      "no-console": [
        "warn",
        {
          allow: ["warn", "error"],
        },
      ],

      "no-debugger": "warn",

      "prefer-const": "error",

      "no-var": "error",

      "object-shorthand": ["error", "always"],

      /*
       |--------------------------------------------------------------------------
       | Formatting handled by Prettier
       |--------------------------------------------------------------------------
       */

    },
  },

  // Disable formatting rules that conflict with Prettier
  eslintConfigPrettier,
);