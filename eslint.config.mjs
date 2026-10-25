import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

// A string literal on the left of `in` is not checked by the compiler (#138).
const IN_LITERAL = {
  selector: "BinaryExpression[operator='in'][left.type=/^(Literal|TemplateLiteral)$/]",
  message: "Use has(value, 'key') from @/lib/has: the key is then checked against the type.",
};

// Drizzle drops an unknown key of a payload that is not a fresh literal (#134):
// a spread, a built object or mapped rows go through columnsOf() / rowsOf(),
// which check every key.
const WRITE =
  "CallExpression:matches([callee.property.name='set'][callee.object.callee.property.name='update'], [callee.property.name='values'][callee.object.callee.property.name='insert'])";
const UPSERT =
  "CallExpression[callee.property.name='onConflictDoUpdate'] > ObjectExpression > Property[key.name='set']";
const CHECKED = "CallExpression[callee.name=/^(columnsOf|rowsOf)$/]";
const PAYLOAD_MESSAGE =
  "Drizzle ignores unknown keys here: write a literal without spread, or wrap the payload in columnsOf(table, …) / rowsOf(table, […]) from @/db/columns-of.";
const DRIZZLE_PAYLOADS = [
  `${WRITE} > ObjectExpression > SpreadElement`,
  `${WRITE} > ArrayExpression > ObjectExpression > SpreadElement`,
  `${WRITE} > ArrayExpression > :not(ObjectExpression)`,
  `${WRITE} > :not(ObjectExpression, ArrayExpression, ${CHECKED}).arguments`,
  `${UPSERT} > ObjectExpression > SpreadElement`,
  `${UPSERT} > :not(ObjectExpression, ${CHECKED}).value`,
].map((selector) => ({ selector, message: PAYLOAD_MESSAGE }));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Type-aware rules (#113): forgotten promises (server actions), unsafe values.
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      "no-restricted-syntax": ["error", IN_LITERAL, ...DRIZZLE_PAYLOADS],
    },
  },
  // Tests may use loose values from fixtures and mocks.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  // Administration scripts: raw SQL rows from the admin client, console output.
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "no-console": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
