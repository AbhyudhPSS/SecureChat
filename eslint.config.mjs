import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Root flat ESLint config. Lints application + package SOURCE only (config files,
 * migrations, and dev scripts are excluded by the lint glob in package.json).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
);
