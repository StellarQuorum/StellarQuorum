import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'bench/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The build* transaction builders are typed stubs whose parameters are
      // the public API; flag unused locals, not unused arguments.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
    },
  },
);
