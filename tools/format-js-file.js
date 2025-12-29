import process from 'node:process';
import fsp from 'node:fs/promises';
import path from 'node:path';


// The first command line argument should be the path to the source file.
const sourceFilePath = process.argv[2];


const JS_FUNCTION_RX = /[#a-zA-Z0-9_]+\([^()]*\)\s\{/;
const JS_SYMBOL_RX = /^[#a-zA-Z0-9_]+/;

const JS_RESERVED_WORDS = [
    'export',
    'default',
    'class',
    'get',
    'set',
    'async',
    'static',
    'function',
    'const',
    'let',
];


async function main() {
    const filepath = path.resolve(sourceFilePath);
    const source = await fsp.readFile(filepath, { encoding: 'utf8' });

    parseSourceFile(source);
}

function parseSourceFile(source) {
    const lines = source.split(/\r?\n/);

    const jsDocBlock = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();

        if (jsDocBlock.length > 0) {
            jsDocBlock.push(line);

            if (line === '*/') {
                const tokens = captureSymbolTokens(lines[i + 1]);
                const jsDocTokens = tokenizeJSDoc(tokens, jsDocBlock);
                printJSDocBlock(jsDocTokens);
                jsDocBlock.length = 0;
                continue;
            }
        } else if (line === '/**') {
            jsDocBlock.push(line);
        }
    }
}

function printJSDocBlock(tokens) {
    // console.log(tokens);
    const obj = jsDocTokenStreamToObject(tokens);
    console.log(obj);
}

function jsDocTokenStreamToObject(tokens) {
    const obj = { definition: 'property' };

    let property = null;
    let parameter = null;
    let typedef = null;
    let error = null;
    let returns = null;

    for (const { type, value } of tokens) {
        if (parameter) {
            if (type === 'type') {
                parameter.type = value;
            } else if (type === 'parameter') {
                parameter.name = value;
            } else if (type === 'parameter-optional') {
                parameter.name = value;
                parameter.optional = true;
            } else if (type === 'default-value') {
                parameter.defaultValue = value;
            } else if (type === 'description') {
                parameter.description = value;
            } else if (type === 'text' && parameter.description) {
                parameter.description = `${ parameter.description } ${ value }`;
            } else {
                // This is the end of the parameter definition
                parameter.optional = Boolean(parameter.optional);
                if (!Array.isArray(obj.parameters)) {
                    obj.parameters = [];
                }
                obj.parameters.push(parameter);
                parameter = null;
            }
        } else if (property) {
            if (type === 'type') {
                property.type = value;
            } else if (type === 'parameter') {
                property.name = value;
            } else if (type === 'parameter-optional') {
                property.name = value;
                property.optional = true;
            } else if (type === 'default-value') {
                property.defaultValue = value;
            } else if (type === 'description') {
                property.description = value;
            } else if (type === 'text' && property.description) {
                property.description = `${ property.description } ${ value }`;
            } else {
                // This is the end of the property definition
                property.optional = Boolean(property.optional);
                if (!Array.isArray(obj.properties)) {
                    obj.properties = [];
                }
                obj.properties.push(property);
                property = null;
            }
        } else if (error) {
            if (type === 'type') {
                error.type = value;
            } else if (type === 'description') {
                error.description = value;
            } else if (type === 'text' && error.description) {
                error.description = `${ error.description } ${ value }`;
            } else {
                // This is the end of the error definition
                if (!Array.isArray(obj.throws)) {
                    obj.throws = [];
                }
                obj.throws.push(error);
                error = null;
            }
        } else if (returns) {
            if (type === 'type') {
                returns.type = value;
            } else if (type === 'description') {
                returns.description = value;
            } else if (type === 'text' && error.description) {
                returns.description = `${ returns.description } ${ value }`;
            } else {
                // This is the end of the returns definition
                obj.returns = returns;
                returns = null;
            }
        } else if (typedef) {
            if (type === 'type') {
                typedef.type = value;
            } else if (type === 'parameter') {
                typedef.name = value;
            } else {
                obj.definition = 'typedef';
                obj.type = typedef.type;
                obj.name = typedef.name;
                typedef = null;
            }
        } else if (type === 'name') {
            obj.name = value;
        } else if (type === 'tag' && value === 'name' && typeof obj.name === 'undefined') {
            // Set the name to null to indicate that the value will follow in the next token.
            obj.name = null;
        } else if (type === 'parameter' && obj.name === null) {
            obj.name = value;
        } else if (type === 'type') {
            obj.type = value;
        } else if (type === 'tag' && value === 'class') {
            obj.definition = 'class';
        } else if (type === 'tag' && value === 'function') {
            obj.definition = 'function';
        } else if (type === 'tag' && value === 'public') {
            obj.isPublic = true;
            obj.isPrivate = false;
        } else if (type === 'tag' && value === 'private') {
            obj.isPrivate = true;
            obj.isPublic = false;
        } else if (type === 'tag' && value === 'readonly') {
            obj.isReadonly = true;
        } else if (type === 'description') {
            obj.description = value;
        } else if (type === 'text' && !obj.description) {
            obj.description = value;
        } else if (type === 'text' && obj.description) {
            obj.description = `${ obj.description } ${ value }`;
        } else if (type === 'empty-line' && obj.description) {
            obj.description = `${ obj.description }\n\n`;
        }

        if (!parameter && type === 'tag' && value === 'param') {
            parameter = {};
        }
        if (!property && type === 'tag' && value === 'property') {
            property = {};
        }
        if (!error && type === 'tag' && value === 'throws') {
            error = {};
        }
        if (!returns && type === 'tag' && value === 'returns') {
            returns = {};
        }
        if (!typedef && type === 'tag' && value === 'typedef') {
            typedef = {};
        }
    }

    if (parameter) {
        // This is the end of the parameter definition
        parameter.optional = Boolean(parameter.optional);
        if (!Array.isArray(obj.parameters)) {
            obj.parameters = [];
        }
        obj.parameters.push(parameter);
        parameter = null;
    }

    if (property) {
        // This is the end of the property definition
        property.optional = Boolean(property.optional);
        if (!Array.isArray(obj.properties)) {
            obj.properties = [];
        }
        obj.properties.push(property);
        property = null;
    }

    if (error) {
        if (!Array.isArray(obj.throws)) {
            obj.throws = [];
        }
        obj.throws.push(error);
        error = null;
    }

    if (returns) {
        obj.returns = returns;
        returns = null;
    }

    if (typedef) {
        obj.definition = 'typedef';
        obj.type = typedef.type;
        obj.name = typedef.name;
        typedef = null;
    }

    return obj;
}

function captureSymbolTokens(line) {
    line = line.trim();

    if (!line || line.startsWith('/**')) {
        // No additional tokens from this line.
        return [];
    }

    const words = line.split(/\s+/);

    let isFunction = JS_FUNCTION_RX.test(line);
    if (isFunction && (words.includes('get') || words.includes('set'))) {
        // Correct for getters and setters like `get myProperty() {}`
        isFunction = false;
    }

    const isStatic = words.includes('static');
    const isClass = words.includes('class');

    const nonReservedWords = words.filter((word) => {
        return !JS_RESERVED_WORDS.includes(word);
    });

    if (nonReservedWords.length < 1) {
        throw new Error(`No symbol words in line ${ line }`);
    }

    const match = JS_SYMBOL_RX.exec(nonReservedWords[0]);

    if (!match) {
        throw new Error(`No symbol word matches in line ${ line }`);
    }

    const name = match[0];

    const tokens = [
        { type: 'line', value: line },
        { type: 'name', value: name },
    ];

    if (isFunction) {
        tokens.push({ type: 'tag', value: 'function' });
    }
    if (isStatic) {
        tokens.push({ type: 'tag', value: 'static' });
    }
    if (isClass) {
        tokens.push({ type: 'tag', value: 'class' });
    }
    if (name.startsWith('#')) {
        tokens.push({ type: 'tag', value: 'private' });
    }

    return tokens;
}

/**
 * Tokenizes a JSDoc block into an array of tokens
 * @param {Array} tokens - Initial tokens, usually from the next line of source code
 * @param {string|string[]} jsdocBlock - The JSDoc block as a string or array of lines
 * @returns {Array<{type: string, value: string}>} Array of token objects
 */
function tokenizeJSDoc(tokens, lines) {

    for (let line of lines) {

        // Remove leading/trailing whitespace and JSDoc markers
        line = line.trim();

        // Skip JSDoc block delimiters
        if (!line || line === '/**' || line === '*/') {
            continue;
        }

        // Remove leading asterisk and space if present
        line = line.replace(/^\*\s?/, '');

        if (!line) {
            tokens.push({ type: 'empty-line', value: '' });
            continue;
        }

        // Check for JSDoc tags (e.g., @param, @returns, @throws)
        const tagMatch = line.match(/^@(\w+)(?:\s+(.+))?$/);
        if (tagMatch) {
            const tagName = tagMatch[1];
            const tagContent = tagMatch[2] || '';

            tokens.push({
                type: 'tag',
                value: tagName,
            });

            if (tagContent) {
                // Parse tag content which may contain type, name, and description
                parseJSDocTagContent(tagContent, tokens);
            }
            continue;
        }

        // Check if this line continues a previous tag (starts with type annotation)
        if (tokens.length > 0 && tokens[tokens.length - 1].type === 'tag') {
            // This is continuation of tag content
            parseJSDocTagContent(line, tokens);
            continue;
        }

        // Plain description text
        tokens.push({
            type: 'text',
            value: line,
        });
    }

    return tokens;
}

/**
 * Parses tag content (type annotations, parameter names, descriptions)
 * @param {string} content - The content after a JSDoc tag
 * @param {Array<{type: string, value: string}>} tokens - Array to append tokens to
 */
function parseJSDocTagContent(content, tokens) {
    content = content.trim();

    if (!content) {
        return;
    }

    // Check for type annotation {Type}
    const typeMatch = content.match(/^\{([^}]+)\}(?:\s+(.+))?$/);
    if (typeMatch) {
        const typeValue = typeMatch[1];
        const rest = typeMatch[2] || '';

        tokens.push({
            type: 'type',
            value: typeValue,
        });

        if (rest) {
            // Parse parameter name and description
            parseJSDocParameterAndDescription(rest, tokens);
        }
        return;
    }

    // No type annotation, could be description or parameter name
    parseJSDocParameterAndDescription(content, tokens);
}

/**
 * Parses parameter name (including optional markers) and description
 * @param {string} content - Content that may contain parameter name and description
 * @param {Array<{type: string, value: string}>} tokens - Array to append tokens to
 */
function parseJSDocParameterAndDescription(content, tokens) {
    content = content.trim();

    if (!content) {
        return;
    }

    // Check for optional parameter with default value: [name=value] or [name.property=value]
    // Default values can be: strings ("foo" or 'foo'), numbers (123, 123.45), booleans (true, false)
    const optionalWithDefaultMatch = content.match(/^\[([\w.]+)=(?:"([^"]*)"|'([^']*)'|([\d.]+|[\w]+))\](\s*-\s*(.+))?$/);
    if (optionalWithDefaultMatch) {
        const paramName = optionalWithDefaultMatch[1];
        const stringValue1 = optionalWithDefaultMatch[2];
        const stringValue2 = optionalWithDefaultMatch[3];
        const nonStringValue = optionalWithDefaultMatch[4];
        const description = optionalWithDefaultMatch[6] || '';

        tokens.push({
            type: 'parameter-optional',
            value: paramName,
        });

        // Extract default value (string, number, or boolean)
        let defaultValue;
        if (typeof stringValue1 !== 'undefined') {
            defaultValue = stringValue1;
        } else if (typeof stringValue2 !== 'undefined') {
            defaultValue = stringValue2;
        } else {
            defaultValue = nonStringValue;
        }

        tokens.push({
            type: 'default-value',
            value: defaultValue,
        });

        if (description) {
            tokens.push({
                type: 'description',
                value: description,
            });
        }
        return;
    }

    // Check for optional parameter without default: [name] or [name.property]
    const optionalMatch = content.match(/^\[([\w.]+)\](\s*-\s*(.+))?$/);
    if (optionalMatch) {
        const paramName = optionalMatch[1];
        const description = optionalMatch[3] || '';

        tokens.push({
            type: 'parameter-optional',
            value: paramName,
        });

        if (description) {
            tokens.push({
                type: 'description',
                value: description,
            });
        }
        return;
    }

    // Check for required parameter: name or name.property
    // Parameter names are typically followed by a dash and description
    const paramMatch = content.match(/^([\w.]+)(?:\s*-\s*(.+))?$/);
    if (paramMatch) {
        const paramName = paramMatch[1];
        const description = paramMatch[2] || '';

        tokens.push({
            type: 'parameter',
            value: paramName,
        });

        if (description) {
            tokens.push({
                type: 'description',
                value: description,
            });
        }
        return;
    }

    // No parameter pattern found, treat as description
    tokens.push({
        type: 'description',
        value: content,
    });
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Error running script:');
    // eslint-disable-next-line no-console
    console.log(error);
});
