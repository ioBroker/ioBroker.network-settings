module.exports = {
    env: {
        browser: true,
        es2021: true,
    },
    extends: [
        'plugin:react/recommended',
        'airbnb',
        // 'react-app',
        'plugin:eqeqeq-fix/recommended',
    ],
    parser: '@babel/eslint-parser',
    parserOptions: {
        ecmaFeatures: {
            jsx: true,
        },
        ecmaVersion: 12,
        sourceType: 'module',
    },
    plugins: [
        'only-warn',
        'react',
    ],
    rules: {
        'arrow-parens': [1, 'as-needed'],
        'react/jsx-indent': 'off',
        'react/jsx-indent-props': 'off',
        'react/no-access-state-in-setstate': 'off',
        'jsx-a11y/click-events-have-key-events': 'off',
        'jsx-a11y/no-static-element-interactions': 'off',
        'no-plusplus': 'off',
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'react/no-render-return-value': 'off',
        'max-len': 'off',
        'react/destructuring-assignment': 'off',
        'react/prefer-stateless-function': 'off',
        'react/self-closing-comp': 'off',
        'react/jsx-filename-extension': 'off',
        'no-nested-ternary': 'off',
        'react/no-array-index-key': 'off',
        'react/jsx-props-no-spreading': 'off',
        'react/sort-comp': 'off',
        'react/no-did-update-set-state': 'off',
        'global-require': 'off',
        'import/extensions': 'off',
        'no-undef': 2,
        'react/forbid-prop-types': 'off',
        'react/require-default-props': 'off',
        'import/no-extraneous-dependencies': 'off',
        'react/jsx-wrap-multilines': 'off',
        'react/jsx-closing-tag-location': 'off',
        'no-restricted-syntax': 'off',
        'guard-for-in': 'off',
        // 'linebreak-style': ["error", "windows"],
        'linebreak-style': ['off'],
        'no-param-reassign': 'off',
        'no-await-in-loop': 'off',
        radix: 'off',
        indent: ['error', 4],
    },
};
