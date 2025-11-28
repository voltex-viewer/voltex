import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import checkFile from 'eslint-plugin-check-file';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'dist-web/**', '.vite/**', 'out/**', '*.config.*']
  },
  {
    plugins: {
      'check-file': checkFile,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'class', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'] },
        { selector: 'typeAlias', format: ['PascalCase'] },
        { selector: 'enum', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
        { selector: 'function', format: ['camelCase'] },
        { selector: 'method', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'property', format: ['camelCase'] },
        { selector: 'classProperty', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': 'CAMEL_CASE' },
        { ignoreMiddleExtensions: true }
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'src/**': 'CAMEL_CASE' }
      ],
    },
  }
);
