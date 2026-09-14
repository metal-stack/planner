import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build scripts run in Node, so they get Node's globals; src/ does not,
    // which is what keeps the client-only invariant honest.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Icons come from src/views/icons (Lucide + custom glyphs) only.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/views/icons/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'lucide-react', message: 'Import icons from src/views/icons.' }] },
      ],
    },
  },
  prettier,
)
