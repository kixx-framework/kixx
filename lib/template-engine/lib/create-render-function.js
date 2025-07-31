import LineSyntaxError from './line-syntax-error.js';
import { escapeHTMLChars } from './utils.js';


export default function createRenderFunction(options, helpers, partials, tokens) {

    function createRenderer(theseTokens) {
        const newTokenStream = [];

        for (const token of theseTokens) {
            switch (token.type) {
                case 'CONTENT':
                    if (newTokenStream.length > 0 && newTokenStream[newTokenStream.length - 1].type === 'CONTENT') {
                        // Combine content tokens whenever possible.
                        newTokenStream[newTokenStream.length - 1].str += token.str;
                    } else {
                        newTokenStream.push(token);
                    }
                    break;
                case 'PATH_EXPRESSION':
                    // Derefernce the exp[0] value now so that we do not need
                    // to do it in the renderer.
                    newTokenStream.push(Object.assign({}, token, { exp: token.exp[0] }));
                    break;
                case 'HELPER_EXPRESSION':
                case 'BLOCK_OPEN':
                    newTokenStream.push(Object.assign({}, token, {
                        type: 'HELPER_FUNCTION',
                        render: createHelperRenderer(token),
                    }));
                    break;
                case 'PARTIAL':
                    newTokenStream.push(Object.assign({}, token, {
                        type: 'PARTIAL_FUNCTION',
                        render: createPartialRenderer(token),
                    }));
                    break;
            }
        }

        return createScopedRenderer(newTokenStream);
    }

    function createHelperRenderer(expressionToken) {
        const helperName = expressionToken.exp[0].path[0];
        const helperFunction = helpers.get(helperName);
        const openToken = expressionToken.tokens[0];

        if (!helperFunction) {
            throw new LineSyntaxError(
                `No helper named "${ helperName }" in "${ openToken.filename }" on line ${ openToken.lineNumber }`,
                openToken
            );
        }

        // Isolate the rest of the expression values.
        const rest = expressionToken.exp.slice(1);

        const positionalArguments = [];
        const namedArguments = {};
        let blockParams = [];

        for (const t of rest) {
            switch (t.type) {
                case 'PATH':
                case 'LITERAL':
                    positionalArguments.push(t);
                    break;
                case 'KEY_VALUE':
                    namedArguments[t.key] = t.value;
                    break;
                case 'BLOCK_PARAMS':
                    blockParams = t.params;
                    break;
            }
        }

        function noopRender() {
            return '';
        }

        let renderPrimary = noopRender;
        let renderInverse = noopRender;

        if (expressionToken.children && expressionToken.children.length > 0) {
            const renderTokens = [];
            // Inverse render tokens are used to create an inverse render function in
            // the if ... else ... scenario.
            const inverseRenderTokens = [];
            let inElse = false;

            for (const t of expressionToken.children) {
                if (inElse) {
                    inverseRenderTokens.push(t);
                } else if (t.type === 'ELSE') {
                    inElse = true;
                } else {
                    renderTokens.push(t);
                }
            }

            if (renderTokens.length > 0) {
                renderPrimary = createRenderer(renderTokens);
            }
            if (inverseRenderTokens.length > 0) {
                renderInverse = createRenderer(inverseRenderTokens);
            }
        }

        return function renderHelper(context) {

            const positionalArgs = positionalArguments.map(mapArgument);

            const namedArgs = Object.keys(namedArguments).reduce((hash, key) => {
                hash[key] = mapArgument(namedArguments[key]);
                return hash;
            }, {});

            function mapArgument(arg) {
                if (arg.type === 'LITERAL') {
                    return arg.value;
                }
                return dereferencePath(context, arg.path);
            }

            const thisHelperContext = {

                blockParams,

                renderPrimary(newContext) {
                    // The new context should be in the nearest scope closure, but the template
                    // still has access to values in upper scopes as long as those values are not
                    // shadowed (just like in JavaScript)
                    return renderPrimary(Object.assign({}, context, newContext));
                },

                renderInverse(newContext) {
                    // The new context should be in the nearest scope closure, but the template
                    // still has access to values in upper scopes as long as those values are not
                    // shadowed (just like in JavaScript)
                    return renderInverse(Object.assign({}, context, newContext));
                },
            };

            let output = '';
            try {
                output = helperFunction.call(thisHelperContext, context, namedArgs, ...positionalArgs);
            } catch (cause) {
                const errorData = Object.assign({ cause }, openToken);

                throw new LineSyntaxError(
                    `Error in helper "${ helperName }" in "${ openToken.filename }" on line ${ openToken.lineNumber }`,
                    errorData
                );
            }

            return output;
        };
    }

    function createPartialRenderer(expressionToken) {
        const openToken = expressionToken.tokens[0];
        const partialName = expressionToken.exp;

        return function renderPartial(context) {
            if (!partials.has(partialName)) {
                throw new LineSyntaxError(
                    `No partial named "${ partialName }" in "${ openToken.filename }" on line ${ openToken.lineNumber }`,
                    openToken
                );
            }

            const partial = partials.get(partialName);
            return partial(context);
        };
    }

    function createScopedRenderer(parts) {

        return function renderContext(context) {
            let output = '';

            for (const part of parts) {
                switch (part.type) {
                    case 'CONTENT':
                        output += part.str;
                        break;
                    case 'PATH_EXPRESSION': {
                        output += escapeHTMLChars(dereferencePath(context, part.exp.path));
                        break;
                    }
                    case 'HELPER_FUNCTION':
                    case 'PARTIAL_FUNCTION':
                        output += part.render(context);
                        break;
                }
            }

            return output;
        };
    }

    // Get a value by walking the JavaScript context object tree using
    // a path (already separated into parts as an Array)
    function dereferencePath(val, path, level = 0) {

        // If this is the last part of the path (leaf node), then return the value.
        if (level === path.length) {
            if (typeof val === 'undefined' || val === null || Number.isNaN(val)) {
                return '';
            }
            return val;
        }

        // Check for helpers by this name before checking the context. Helper names always
        // have a path length of 1 (they are not nested).
        if (path.length === 1 && helpers.has(path[0])) {
            return helpers.get(path[0]);
        }

        const key = path[level];
        return dereferencePath((val || {})[key], path, level + 1);
    }

    return createRenderer(tokens);
}
