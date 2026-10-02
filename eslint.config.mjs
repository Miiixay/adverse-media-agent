import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // The agent is framework-agnostic: the only thing crossing the boundary is the
    // ScreeningInput -> ScreeningResult contract exposed by screenIndividual().
    files: ["src/agent/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*", "**/app/*"],
              message: "src/agent must not depend on Next.js or the app layer.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "logs/**"]),
]);

export default eslintConfig;
