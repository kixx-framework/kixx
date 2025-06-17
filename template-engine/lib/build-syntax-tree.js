import LineSyntaxError from './line-syntax-error.js';


export default function buildSyntaxTree(options, tokens) {
    const tree = [];
    const blocks = [];

    let mustacheOpenToken = null;
    let commentOpenToken = null;
    let expressionParts = [];

    for (const token of tokens) {
        if (token.tokenString === '{{') {
            if (mustacheOpenToken) {
                throw new LineSyntaxError(
                    `Failed to close mustache opened in ${ mustacheOpenToken.filename } on line ${ mustacheOpenToken.lineNumber }`,
                    mustacheOpenToken
                );
            } else {
                mustacheOpenToken = token;
            }
        } else if (token.tokenString === '{{!--') {
            if (commentOpenToken) {
                throw new LineSyntaxError(
                    `Failed to close comment opened in ${ commentOpenToken.filename } on line ${ commentOpenToken.lineNumber }`,
                    commentOpenToken
                );
            } else {
                commentOpenToken = token;
            }
        } else if (mustacheOpenToken && token.tokenString === '}}') {
            addExpression(mustacheOpenToken, token, expressionParts);
            expressionParts = [];
            mustacheOpenToken = null;
        } else if (commentOpenToken && token.tokenString === '--}}') {
            commentOpenToken = null;
        } else if (mustacheOpenToken) {
            expressionParts.push(token);
        } else if (commentOpenToken) {
            pushNode({
                type: 'COMMENT',
                tokens: [ token ],
            });
        } else if (!mustacheOpenToken && !commentOpenToken) {
            pushNode({
                type: 'CONTENT',
                str: token.tokenString,
                tokens: [ token ],
            });
        }
    }

    if (mustacheOpenToken) {
        throw new LineSyntaxError(
            `Failed to close mustache opened in ${ mustacheOpenToken.filename } on line ${ mustacheOpenToken.lineNumber }`,
            mustacheOpenToken
        );
    }
    if (commentOpenToken) {
        throw new LineSyntaxError(
            `Failed to close comment opened in ${ commentOpenToken.filename } on line ${ commentOpenToken.lineNumber }`,
            commentOpenToken
        );
    }
    if (blocks.length > 0) {
        const token = blocks[0].tokens[0];
        throw new LineSyntaxError(
            `Failed to close block opened in ${ token.filename } on line ${ token.lineNumber }`,
            token
        );
    }

    // Called with an expression token (the tokens between {{ }} mustaches).
    function addExpression(openToken, closeToken, parts) {
        // The "parts" are the tokens representing a single expression which was split over more than 1 line.
        const tokenString = parts.map((t) => t.tokenString.trim()).join(' ');

        // Some expressions are explicitly typed using the first few characters.
        if (tokenString.startsWith('#')) {
            pushBlockOpen({
                type: 'BLOCK_OPEN',
                exp: parseExpression(openToken, closeToken, tokenString.slice(1).trim()),
                children: [],
                tokens: parts,
            });
        } else if (tokenString.startsWith('/')) {
            pushBlockClose({
                type: 'BLOCK_CLOSE',
                exp: tokenString.slice(1).trim(),
                tokens: parts,
            });
        } else if (tokenString.startsWith('>')) {
            pushNode({
                type: 'PARTIAL',
                exp: tokenString.slice(1).trim(),
                tokens: parts,
            });
        } else if (tokenString === 'else') {
            pushNode({ type: 'ELSE', tokens: parts });
        } else {
            pushNode(createExpressionNode(openToken, closeToken, parts, tokenString));
        }
    }

    function createExpressionNode(openToken, closeToken, parts, tokenString) {
        const exp = parseExpression(openToken, closeToken, tokenString);

        // An expression length less than 1 would indicate an
        // empty mustache like this: "{{ }}". We just igore it.
        const type = exp.length <= 1 ? 'PATH_EXPRESSION' : 'HELPER_EXPRESSION';

        return {
            type,
            exp,
            tokens: parts,
        };
    }

    function parseExpression(openToken, closeToken, tokenString) {
        const expressionTokens = [];
        let subToken = null;
        let expressionTokenString = '';
        let inBracket = false;
        let inBlockParams = false;
        let inStringLiteral = false;
        let inStartKeyValue = false;
        let stringLiteral = '';
        let charIndex = 0;

        function pushExpressionToken(attrs) {
            if (subToken) {
                expressionTokens.push(Object.assign(subToken, attrs));
            }
            subToken = null;
        }

        // Called at the end of a string literal or space delineated expression.
        function closeSpaceDelineatedSubToken() {
            if (subToken && subToken.type === 'KEY_VALUE') {
                if (inStringLiteral) {
                    pushExpressionToken({
                        value: { type: 'LITERAL', value: stringLiteral },
                    });
                } else if (expressionTokenString) {
                    pushExpressionToken({
                        value: parseSymbols(openToken, closeToken, expressionTokenString),
                    });
                }
            } else if (inStringLiteral) {
                expressionTokens.push({ type: 'LITERAL', value: stringLiteral });
            } else if (expressionTokenString) {
                expressionTokens.push(parseSymbols(openToken, closeToken, expressionTokenString));
            }
        }

        for (; charIndex < tokenString.length; charIndex += 1) {
            const c = tokenString[charIndex];

            if (inStartKeyValue) {
                // Absorb whitespace after the "=" in a key/value expression.
                if (/\s/.test(c)) {
                    continue;
                }
                inStartKeyValue = false;
            }
            if (inStringLiteral) {
                if (c === inStringLiteral) {
                    closeSpaceDelineatedSubToken();
                    inStringLiteral = false;
                    stringLiteral = '';
                } else {
                    stringLiteral += c;
                }
                continue;
            }
            if (inBracket) {
                expressionTokenString += c;
                if (c === ']') {
                    inBracket = false;
                }
                continue;
            }
            if (inBlockParams) {
                if (c === '|') {
                    pushExpressionToken({
                        // Split the params on a space " " after removing extra whitespace.
                        // The /[\s]+/g regex will collapse whitespace including new lines.
                        params: expressionTokenString.trim().replace(/[\s]+/g, ' ').split(' '),
                    });
                    inBlockParams = false;
                    expressionTokenString = '';
                } else {
                    expressionTokenString += c;
                }
                continue;
            }
            if (c === '[') {
                inBracket = true;
                expressionTokenString += c;
                continue;
            }
            if (c === '"' || c === "'") {
                inStringLiteral = c;
                stringLiteral = '';
                continue;
            }
            if (c === '=') {
                let key;
                const lastSubToken = expressionTokens[expressionTokens.length - 1];
                if (lastSubToken && lastSubToken.type === 'PATH') {
                    key = validateKeyValueKey(openToken, closeToken, lastSubToken.pathString);
                    // Throw away the last PATH since we converted it to the key in key/value.
                    expressionTokens.pop();
                } else {
                    key = validateKeyValueKey(openToken, closeToken, expressionTokenString);
                }
                inStartKeyValue = true;
                subToken = { type: 'KEY_VALUE', key };
                expressionTokenString = '';
                continue;
            }
            if (c === '|') {
                const lastSubToken = expressionTokens[expressionTokens.length - 1];
                if (lastSubToken && lastSubToken.type === 'PATH' && lastSubToken.path[0] === 'as') {
                    // Throw away the "as" PATH
                    expressionTokens.pop();
                }
                inBlockParams = true;
                subToken = { type: 'BLOCK_PARAMS' };
                expressionTokenString = '';
                continue;
            }
            if (/\s/.test(c)) {
                closeSpaceDelineatedSubToken();
                expressionTokenString = '';
            } else {
                expressionTokenString += c;
            }
        }

        if (inBracket) {
            throw new LineSyntaxError(
                `Unclosed bracket "[...]" in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                openToken
            );
        }
        if (inBlockParams) {
            throw new LineSyntaxError(
                `Unclosed block params in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                openToken
            );
        }
        if (inStringLiteral) {
            throw new LineSyntaxError(
                `Unclosed string literal in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                openToken
            );
        }
        if (inStartKeyValue) {
            throw new LineSyntaxError(
                `No value defined for key/value after "=" in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                openToken
            );
        }

        closeSpaceDelineatedSubToken();

        return expressionTokens;
    }

    // Parse a sub-token of the expression token, looking for JavaScript literals and reference paths.
    function parseSymbols(openToken, closeToken, expressionString) {
        const rv = { type: 'LITERAL' };

        // String literal is already handled.

        switch (expressionString.trim()) {
            case 'true':
                rv.value = true;
                return rv;
            case 'false':
                rv.value = false;
                return rv;
            case 'null':
                rv.value = null;
                return rv;
            case 'undefined':
                rv.value = undefined;
                return rv;
            default:
                return castToNumberOrReferencePath(expressionString);
        }

        function castToNumberOrReferencePath(str) {
            // Since we already captured string literals then we are only worried about
            // differentiating between numbers and paths here.
            const val = maybeCastToInt(str);

            if (typeof val === 'number') {
                // Literal number
                rv.value = val;
                return rv;
            }

            // A string, so we assume this is a reference path;
            rv.type = 'PATH';
            rv.path = parseReferencePath(openToken, closeToken, str);
            rv.pathString = str;
            return rv;
        }
    }

    function parseReferencePath(openToken, closeToken, refpath) {
        if (refpath[0] === '.') {
            throw new LineSyntaxError(
                `A reference path cannot start with "." in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                openToken
            );
        }

        // The refpath is the space delineated part of the full tokenString (spaces are allowed in brackets []).
        const parts = [];
        let inBracket = false;
        let tokenString = '';

        let charIndex = 0;
        for (; charIndex < refpath.length; charIndex += 1) {
            const c = refpath[charIndex];

            if (inBracket) {
                if (c === ']') {
                    parts.push(maybeCastToInt(tokenString));
                    inBracket = false;
                    tokenString = '';
                } else {
                    tokenString += c;
                }
            } else if (c === '.') {
                parts.push(tokenString);
                tokenString = '';
            } else if (/\w/.test(c)) {
                tokenString += c;
            } else if (c === '[') {
                inBracket = true;
                parts.push(tokenString);
                tokenString = '';
            } else {
                throw new LineSyntaxError(
                    `Invalid JavaScript symbol character "${ c }" in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                    openToken
                );
            }
        }

        if (tokenString) {
            parts.push(tokenString);
        }

        return parts;
    }

    function validateKeyValueKey(openToken, closeToken, key) {
        if (/^[\W]+$/.test(key)) {
            throw new LineSyntaxError(
                `Invalid characters in key "${ key }" in expression in ${ openToken.filename } starting on line ${ openToken.lineNumber }`,
                openToken
            );
        }
        return key;
    }

    function maybeCastToInt(str) {
        if (/\D/.test(str)) {
            // If there are any non-numeric charcters we treat the whole thing like a string.
            return str;
        }
        const num = Number.parseInt(str, 10);
        if (Number.isNaN(num)) {
            return str;
        }
        return num;
    }

    // Special handler for nested block openers.
    function pushBlockOpen(node) {
        if (blocks.length > 0) {
            blocks[blocks.length - 1].children.push(node);
        } else {
            tree.push(node);
        }

        blocks.push(node);
    }

    // Special handler for nested block closers.
    function pushBlockClose(node) {
        if (blocks.length > 0) {
            blocks[blocks.length - 1].children.push(node);
        } else {
            tree.push(node);
        }
        blocks.pop();
    }

    function pushNode(node) {

        // If we are in a sub block then push the node onto the current branch of the AST.
        if (blocks.length > 0) {
            blocks[blocks.length - 1].children.push(node);
        } else {
            tree.push(node);
        }
    }

    return tree;
}
