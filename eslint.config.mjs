import js from '@eslint/js';


export default [
    {
        ignores: [
            'node_modules/',
            'vendor/',
            // Other vendor/dependency directories:
            'assertions/',
            'errors/',
            'logger/',
            'template-engine/',
            // Client side JS in reference app:
            'reference-app/templates/',
        ],
    },
    js.configs.recommended,
    {
        languageOptions: {
            // See https://node.green/#ES2022
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // Web globals
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                structuredClone: 'readonly',
                Blob: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                Headers: 'readonly',
                // Node.js globals
                Buffer: 'readonly',
                queueMicrotask: 'readonly',
            },
        },
        rules: {
            'array-bracket-spacing': [
                'error',
                'always',
                { objectsInArrays: false },
            ],
            'arrow-parens': [
                'error',
                'always',
            ],
            'arrow-spacing': [
                'error',
            ],
            'block-spacing': [
                'error',
            ],
            'brace-style': [
                'error',
            ],
            'capitalized-comments': [
                'off',
            ],
            'comma-dangle': [
                'error',
                {
                    arrays: 'always-multiline',
                    objects: 'always-multiline',
                    functions: 'never',
                    imports: 'never',
                    exports: 'never',
                },
            ],
            'comma-spacing': [
                'error',
            ],
            'comma-style': [
                'error',
            ],
            // Authors have the freedom to return something or not.
            'consistent-return': [
                'off',
            ],
            curly: [
                'error',
            ],
            'default-case-last': [
                'error',
            ],
            'eol-last': [
                'error',
            ],
            eqeqeq: [
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
            'grouped-accessor-pairs': [
                'error',
                'getBeforeSet',
            ],
            'guard-for-in': [
                'error',
            ],
            'implicit-arrow-linebreak': [
                'error',
            ],
            indent: [
                'error',
                4,
                { SwitchCase: 1 },
            ],
            'key-spacing': [
                'error',
                { beforeColon: false, afterColon: true },
            ],
            'keyword-spacing': [
                'error',
            ],
            // Turn linebreak-style off to accomodate windows. Linebreaks will be converted
            // to Windows format on checkout, but converted back to unix on commit.
            'linebreak-style': [
                'off',
                'unix',
            ],
            'lines-between-class-members': [
                'error',
                'always',
                { exceptAfterSingleLine: true },
            ],
            'max-statements-per-line': [
                'error',
                { max: 1 },
            ],
            'new-cap': [
                'error',
            ],
            'new-parens': [
                'error',
            ],
            // Performing an await as part of each operation may indicate that
            // the program is not taking full advantage of the parallelization
            // benefits of async/await.
            // Often, the code can be refactored to create all the promises at
            // once, then get access to the results using Promise.all()
            'no-await-in-loop': [
                'warn',
            ],
            'no-bitwise': [
                'warn',
            ],
            'no-caller': [
                'error',
            ],
            'no-console': [
                'error',
            ],
            'no-constant-binary-expression': [
                'error',
            ],
            'no-duplicate-imports': [
                'error',
            ],
            'no-else-return': [
                'error',
            ],
            'no-eq-null': [
                'error',
            ],
            'no-eval': [
                'error',
            ],
            'no-extend-native': [
                'error',
            ],
            'no-floating-decimal': [
                'error',
            ],
            'no-implicit-coercion': [
                'error',
            ],
            'no-implied-eval': [
                'error',
            ],
            'no-invalid-this': [
                'error',
            ],
            'no-lonely-if': [
                'error',
            ],
            'no-loop-func': [
                'error',
            ],
            'no-mixed-operators': [
                'warn',
            ],
            'no-multi-assign': [
                'error',
            ],
            'no-multi-spaces': [
                'error',
            ],
            'no-nested-ternary': [
                'error',
            ],
            'no-new-wrappers': [
                'error',
            ],
            'no-plusplus': [
                'error',
            ],
            'no-promise-executor-return': [
                'error',
            ],
            'no-return-assign': [
                'error',
            ],
            'no-return-await': [
                'error',
            ],
            'no-sequences': [
                'error',
            ],
            'no-shadow': [
                'error',
                { builtinGlobals: true, hoist: 'all' },
            ],
            'no-template-curly-in-string': [
                'error',
            ],
            'no-throw-literal': [
                'error',
            ],
            'no-trailing-spaces': [
                'error',
            ],
            // In ECMAScript 3 it was possible to overwrite the value of
            // undefined. ECMAScript 5 disallows overwriting undefined and we
            // assume authors are responsible about mistakenly shadowing it.
            'no-undefined': [
                'off',
            ],
            // Authors should be able to dangles as they see fit to
            // make code readable.
            'no-underscore-dangle': [
                'off',
            ],
            'no-unmodified-loop-condition': [
                'error',
            ],
            'no-unreachable-loop': [
                'error',
            ],
            'no-unused-expressions': [
                'error',
            ],
            'no-useless-computed-key': [
                'error',
            ],
            'no-useless-concat': [
                'error',
            ],
            'no-useless-constructor': [
                'error',
            ],
            'no-useless-return': [
                'error',
            ],
            'no-use-before-define': [
                'error',
                { functions: false, classes: false },
            ],
            'no-var': [
                'error',
            ],
            'no-warning-comments': [
                'warn',
                { location: 'anywhere' },
            ],
            'no-whitespace-before-property': [
                'error',
            ],
            'object-curly-spacing': [
                'error',
                'always',
            ],
            'object-shorthand': [
                'error',
                'always',
            ],
            'operator-linebreak': [
                'error',
                'before',
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
            quotes: [
                'error',
                'single',
                { avoidEscape: true, allowTemplateLiterals: true },
            ],
            // Authors can quote props, even when not necessary, to
            // make the code readable.
            'quote-props': [
                'off',
            ],
            radix: [
                'error',
            ],
            'require-atomic-updates': [
                'error',
            ],
            // Sometimes we want to use the async keyword to promisify a
            // function without using await internally.
            'require-await': [
                'off',
            ],
            'rest-spread-spacing': [
                'error',
                'never',
            ],
            semi: [
                'error',
                'always',
            ],
            'semi-spacing': [
                'error',
            ],
            'spaced-comment': [
                'error',
            ],
            'space-before-blocks': [
                'error',
            ],
            'space-before-function-paren': [
                'error',
                {
                    anonymous: 'always',
                    asyncArrow: 'always',
                    named: 'never',
                },
            ],
            'space-in-parens': [
                'error',
            ],
            'space-infix-ops': [
                'error',
            ],
            'space-unary-ops': [
                'error',
                { words: true, nonwords: false },
            ],
            strict: [
                'error',
            ],
            'switch-colon-spacing': [
                'error',
            ],
            'template-curly-spacing': [
                'error',
                'always',
            ],
            'template-tag-spacing': [
                'error',
                'always',
            ],
            'wrap-iife': [
                'error',
                'outside',
            ],
        },
    },
];
