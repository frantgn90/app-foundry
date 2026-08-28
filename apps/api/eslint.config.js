import base from '@app-foundry/config/eslint';

export default [
  ...base,
  {
    rules: {
      /*
       * La inyección de dependencias de Nest resuelve los servicios por el tipo
       * del parámetro del constructor, que solo existe en tiempo de ejecución si
       * el import es de valor. Forzar `import type` aquí rompería la DI.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
