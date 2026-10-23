// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
    {
        ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/src/generated/**"],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                // Config files at the root and in each package aren't in a tsconfig
                projectService: { allowDefaultProject: ["*.mjs", "*/*.ts", "services/*/*.ts"] },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            // Express augmentation in shared/src/auth/express.ts needs `declare global { namespace Express }`
            "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
            // Joi's validate() and Express's req.body are typed `any`, so these flag every validated value
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
        },
    },
    {
        files: ["**/*.mjs"],
        extends: [tseslint.configs.disableTypeChecked],
    },
    // Must stay last: turns off rules that conflict with Prettier
    prettier,
);
