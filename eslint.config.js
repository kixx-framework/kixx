export default [
    {
        ignores: [
            'lib/vendor/',
            'node_modules/',
            'tmp/',
        ],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                Blob: 'readonly',
                Uint8Array: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                FormData: 'readonly',
                Date: 'readonly',
                fetch: 'readonly',
                Headers: 'readonly',
                ReadableStream: 'readonly',
                Request: 'readonly',
                Response: 'readonly',
                URL: 'readonly',
                atob: 'readonly',
                btoa: 'readonly',
                setTimeout: 'readonly',
                console: 'readonly',
                structuredClone: 'readonly',
                crypto: 'readonly',
            },
        },
        rules: {
            'comma-dangle': [
                'error',
                {
                    arrays: 'always-multiline',
                    objects: 'always-multiline',
                    functions: 'always-multiline',
                    imports: 'always-multiline',
                    exports: 'always-multiline',
                },
            ],
            'constructor-super': [
                'error',
            ],
            'default-case-last': [
                'error',
            ],
            'eol-last': [
                'error',
            ],
            'eqeqeq': [
                'error',
            ],
            'for-direction': [
                'error',
            ],
            'func-call-spacing': [
                'error',
            ],
            'func-style': [
                'error',
                'declaration',
                { allowArrowFunctions: true },
            ],
            'getter-return': [
                'error',
            ],
            'grouped-accessor-pairs': [
                'error',
                'getBeforeSet',
            ],
            indent: [
                'error',
                4,
                { SwitchCase: 1 },
            ],
            'max-statements-per-line': [
                'error',
                { max: 1 },
            ],
            'new-parens': [
                'error',
            ],
            'no-async-promise-executor': [
                'error',
            ],
            'no-caller': [
                'error',
            ],
            'no-case-declarations': [
                'error',
            ],
            'no-class-assign': [
                'error',
            ],
            'no-compare-neg-zero': [
                'error',
            ],
            'no-cond-assign': [
                'error',
            ],
            'no-console': [
                'error',
            ],
            'no-const-assign': [
                'error',
            ],
            'no-constant-binary-expression': [
                'error',
            ],
            'no-constant-condition': [
                'error',
            ],
            'no-control-regex': [
                'error',
            ],
            'no-debugger': [
                'error',
            ],
            'no-duplicate-imports': [
                'error',
            ],
            'no-dupe-class-members': [
                'error',
            ],
            'no-dupe-else-if': [
                'error',
            ],
            'no-dupe-keys': [
                'error',
            ],
            'no-duplicate-case': [
                'error',
            ],
            'no-else-return': [
                'error',
            ],
            'no-empty': [
                'error',
            ],
            'no-empty-character-class': [
                'error',
            ],
            'no-eq-null': [
                'error',
            ],
            'no-ex-assign': [
                'error',
            ],
            'no-extend-native': [
                'error',
            ],
            'no-floating-decimal': [
                'error',
            ],
            'no-func-assign': [
                'error',
            ],
            'no-global-assign': [
                'error',
            ],
            'no-implicit-coercion': [
                'error',
            ],
            'no-invalid-regexp': [
                'error',
            ],
            'no-invalid-this': [
                'error',
            ],
            'no-irregular-whitespace': [
                'error',
            ],
            'no-lonely-if': [
                'error',
            ],
            'no-loop-func': [
                'error',
            ],
            'no-loss-of-precision': [
                'error',
            ],
            'no-misleading-character-class': [
                'error',
            ],
            'no-mixed-operators': [
                'warn',
            ],
            'no-multi-assign': [
                'error',
            ],
            'no-nested-ternary': [
                'error',
            ],
            'no-new-native-nonconstructor': [
                'error',
            ],
            'no-new-wrappers': [
                'error',
            ],
            'no-obj-calls': [
                'error',
            ],
            'no-plusplus': [
                'error',
            ],
            'no-prototype-builtins': [
                'error',
            ],
            'no-promise-executor-return': [
                'error',
            ],
            'no-regex-spaces': [
                'error',
            ],
            'no-return-assign': [
                'error',
            ],
            'no-sequences': [
                'error',
            ],
            'no-setter-return': [
                'error',
            ],
            'no-shadow-restricted-names': [
                'error',
            ],
            'no-template-curly-in-string': [
                'error',
            ],
            'no-this-before-super': [
                'error',
            ],
            'no-throw-literal': [
                'error',
            ],
            'no-trailing-spaces': [
                'error',
            ],
            'no-unassigned-vars': [
                'error',
            ],
            'no-undef': [
                'error',
            ],
            'no-unexpected-multiline': [
                'error',
            ],
            'no-unmodified-loop-condition': [
                'error',
            ],
            'no-unreachable': [
                'error',
            ],
            'no-unsafe-finally': [
                'error',
            ],
            'no-unsafe-negation': [
                'error',
            ],
            'no-unused-expressions': [
                'error',
            ],
            'no-unused-labels': [
                'error',
            ],
            'no-unused-private-class-members': [
                'error',
            ],
            'no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    args: 'all',
                    caughtErrors: 'all',
                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
            'no-use-before-define': [
                'error',
                { functions: false, classes: false },
            ],
            'no-useless-catch': [
                'error',
            ],
            'no-useless-computed-key': [
                'error',
            ],
            'no-var': [
                'error',
            ],
            'no-warning-comments': [
                'warn',
                { location: 'anywhere' },
            ],
            'preserve-caught-error': [
                'error',
            ],
            // Prevents programmer errors mistakenly refering to the wrong `this`.
            'prefer-arrow-callback': [
                'error',
                {
                    allowNamedFunctions: true,
                    allowUnboundThis: false,
                },
            ],
            'prefer-const': [
                'error',
            ],
            'prefer-numeric-literals': [
                'error',
            ],
            'prefer-promise-reject-errors': [
                'error',
            ],
            'prefer-rest-params': [
                'error',
            ],
            'radix': [
                'error',
            ],
            'require-yield': [
                'error',
            ],
            'rest-spread-spacing': [
                'error',
                'never',
            ],
            'semi': [
                'error',
                'always',
                { omitLastInOneLineBlock: true },
            ],
            'strict': [
                // Turn strict off:
                // 1. We use modules for server and tooling code (which is strict by default).
                // 2. Browser scripts are embedded in self-invoking functions with "use strict" already there.
                'off',
            ],
            'use-isnan': [
                'error',
            ],
            'valid-typeof': [
                'error',
            ],
        },
    },
];
