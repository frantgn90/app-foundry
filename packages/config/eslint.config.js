import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Configuración base compartida por todo el monorepo.
 *
 * Se apoya en `recommendedTypeChecked`: las reglas que necesitan información de
 * tipos son las que atrapan los errores que de verdad duelen en código asíncrono
 * —promesas sin await, condiciones siempre ciertas—, y son la razón por la que el
 * monorepo se queda en TypeScript 6 hasta que typescript-eslint soporte la 7.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  prettier,
);
