import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist/", "node_modules/", ".agents/", ".claude/", "assets/", "textures/", "test/baselines/"],
	},
	js.configs.recommended,
	{
		files: ["**/*.ts"],
		extends: [tseslint.configs.recommended],
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["vite-env.d.ts", "vitest.config.ts"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/await-thenable": "error",
		},
	},
	{
		files: ["test/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		rules: {
			"prefer-const": "error",
			eqeqeq: ["error", "always"],
		},
	},
);
