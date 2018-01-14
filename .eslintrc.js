module.exports = {
	"parserOptions": {
		"ecmaVersion": 2017
	},
	"env": {
		"es6": true,
		"node": true
	},
	"extends": "eslint:recommended",
	"rules": {
		"strict": [
			"error"
		],
		"no-const-assign": [
			"error"
		],
		"no-var": [
			"error"
		],
		"prefer-const": [
			"error"
		],
		"one-var": [
			"error",
			"never"
		],
		"no-unused-vars": [
			"error",
			{"args": "none"}
		],
		"no-use-before-define": [
			"error",
			{"functions": false, "classes": false}
		],
		"no-caller": [
			"error"
		],
		"semi": [
			"error",
			"always"
		],
		"curly": [
			"error",
			"multi-line"
		],
		"comma-dangle": [
			"error",
			"never"
		],
		"eqeqeq": [
			"error",
			"always"
		],
		"arrow-parens": [
			"error",
			"always"
		],
		"wrap-iife": [
			"error"
		],
		"no-shadow-restricted-names": [
			"error"
		],
		"no-undefined": [
			"error"
		],
		"no-new-symbol": [
			"error"
		],
		"no-labels": [
			"error"
		],
		"for-direction": [
			"error"
		],
		"no-extra-parens": [
			"error"
		],
		"no-prototype-builtins": [
			"error"
		],
		"no-template-curly-in-string": [
			"error"
		],
		"array-callback-return": [
			"error"
		],
		"no-floating-decimal": [
			"error"
		],
		"radix": [
			"error"
		],
		"no-multi-spaces": [
			"error"
		],
		"indent": [
			"error",
			"tab",
			{"SwitchCase": 1}
		],
		"quotes": [
			"error",
			"backtick"
		],
		"no-mixed-requires": [
			"error",
			{"grouping": true, "allowCall": true}
		],
		"no-process-env": [
			"error"
		],
		"no-console": [
			"error"
		],
		"no-warning-comments": [
			"warn",
			{location: "anywhere"}
		],
		"eol-last": [
			"error"
		]
	}
};