const DEFAULT_DELIMITER = "/";
const NOOP_VALUE = (value) => value;
const ID_START = /^[$_\p{ID_Start}]$/u;
const ID_CONTINUE = /^[$\u200c\u200d\p{ID_Continue}]$/u;
const ID = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
/**
 * Escape text for stringify to path.
 */
function escapeText(str) {
    return str.replace(/[{}()\[\]+?!:*\\]/g, "\\$&");
}
/**
 * Escape a regular expression string.
 */
function escape(str) {
    return str.replace(/[.+*?^${}()[\]|/\\]/g, "\\$&");
}
/**
 * ParseError is thrown when there is an error processing the path.
 */
export class PathError extends TypeError {
    originalPath;
    constructor(message, originalPath) {
        super(message +
            (originalPath ? `: ${originalPath}` : "") +
            "; visit https://git.new/pathToRegexpError for info");
        this.originalPath = originalPath;
    }
}
/**
 * Parse a string for the raw tokens.
 */
export function parse(str, options = {}) {
    const { encodePath = NOOP_VALUE } = options;
    const chars = [...str];
    let index = 0;
    function consumeUntil(end) {
        const output = [];
        let path = "";
        function writePath() {
            if (!path)
                return;
            output.push({
                type: "text",
                value: encodePath(path),
            });
            path = "";
        }
        while (index < chars.length) {
            const char = chars[index++];
            if (char === end) {
                writePath();
                return output;
            }
            if (char === "\\") {
                if (index === chars.length) {
                    throw new PathError(`Unexpected end after \\ at index ${index}`, str);
                }
                path += chars[index++];
                continue;
            }
            if (char === ":" || char === "*") {
                const type = char === ":" ? "param" : "wildcard";
                let name = "";
                if (ID_START.test(chars[index])) {
                    do {
                        name += chars[index++];
                    } while (ID_CONTINUE.test(chars[index]));
                }
                else if (chars[index] === '"') {
                    let quoteStart = index;
                    while (index < chars.length) {
                        if (chars[++index] === '"') {
                            index++;
                            quoteStart = 0;
                            break;
                        }
                        // Increment over escape characters.
                        if (chars[index] === "\\")
                            index++;
                        name += chars[index];
                    }
                    if (quoteStart) {
                        throw new PathError(`Unterminated quote at index ${quoteStart}`, str);
                    }
                }
                if (!name) {
                    throw new PathError(`Missing parameter name at index ${index}`, str);
                }
                writePath();
                output.push({ type, name });
                continue;
            }
            if (char === "{") {
                writePath();
                output.push({
                    type: "group",
                    tokens: consumeUntil("}"),
                });
                continue;
            }
            if ("}()[]+?!".includes(char)) {
                throw new PathError(`Unexpected ${char} at index ${index - 1}`, str);
            }
            path += char;
        }
        if (end) {
            throw new PathError(`Unexpected end at index ${index}, expected ${end}`, str);
        }
        writePath();
        return output;
    }
    return {
        tokens: consumeUntil(""),
        originalPath: str,
    };
}
/**
 * Compile a string to a template function for the path.
 */
export function compile(path, options = {}) {
    const { encode = encodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
    const data = typeof path === "object" ? path : parse(path, options);
    const fn = tokensToFunction(data.tokens, delimiter, encode);
    return function path(params = {}) {
        const missing = [];
        const path = fn(params, missing);
        if (missing.length) {
            throw new TypeError(`Missing parameters: ${missing.join(", ")}`);
        }
        return path;
    };
}
function tokensToFunction(tokens, delimiter, encode) {
    const encoders = tokens.map((token) => tokenToFunction(token, delimiter, encode));
    return (data, missing) => {
        let result = "";
        for (const encoder of encoders) {
            result += encoder(data, missing);
        }
        return result;
    };
}
/**
 * Convert a single token into a path building function.
 */
function tokenToFunction(token, delimiter, encode) {
    if (token.type === "text")
        return () => token.value;
    if (token.type === "group") {
        const fn = tokensToFunction(token.tokens, delimiter, encode);
        return (data, missing) => {
            const len = missing.length;
            const value = fn(data, missing);
            if (missing.length === len)
                return value;
            missing.length = len; // Reset optional group.
            return "";
        };
    }
    const encodeValue = encode || NOOP_VALUE;
    if (token.type === "wildcard" && encode !== false) {
        return (data, missing) => {
            const value = data[token.name];
            if (value == null) {
                missing.push(token.name);
                return "";
            }
            if (!Array.isArray(value) || value.length === 0) {
                throw new TypeError(`Expected "${token.name}" to be a non-empty array`);
            }
            let result = "";
            for (let i = 0; i < value.length; i++) {
                if (typeof value[i] !== "string") {
                    throw new TypeError(`Expected "${token.name}/${i}" to be a string`);
                }
                if (i > 0)
                    result += delimiter;
                result += encodeValue(value[i]);
            }
            if (!result) {
                throw new TypeError(`Expected "${token.name}" to be a non-empty array`);
            }
            return result;
        };
    }
    return (data, missing) => {
        const value = data[token.name];
        if (value == null) {
            missing.push(token.name);
            return "";
        }
        if (typeof value !== "string" || value.length === 0) {
            throw new TypeError(`Expected "${token.name}" to be a non-empty string`);
        }
        return encodeValue(value);
    };
}
/**
 * Transform a path into a match function.
 */
export function match(path, options = {}) {
    const { decode = decodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
    const { regexp, keys } = pathToRegexp(path, options);
    const decoders = keys.map((key) => {
        if (decode === false)
            return NOOP_VALUE;
        if (key.type === "param")
            return decode;
        return (value) => value.split(delimiter).map(decode);
    });
    return function match(input) {
        const m = regexp.exec(input);
        if (!m)
            return false;
        const path = m[0];
        const params = Object.create(null);
        for (let i = 1; i < m.length; i++) {
            if (m[i] === undefined)
                continue;
            const key = keys[i - 1];
            const decoder = decoders[i - 1];
            params[key.name] = decoder(m[i]);
        }
        return { path, params };
    };
}
/**
 * Transform a path into a regular expression and capture keys.
 */
export function pathToRegexp(path, options = {}) {
    const { delimiter = DEFAULT_DELIMITER, end = true, sensitive = false, trailing = true, } = options;
    const keys = [];
    let source = "";
    let combinations = 0;
    function process(path) {
        if (Array.isArray(path)) {
            for (const p of path)
                process(p);
            return;
        }
        const data = typeof path === "object" ? path : parse(path, options);
        flatten(data.tokens, 0, [], (tokens) => {
            if (combinations >= 256) {
                throw new PathError("Too many path combinations", data.originalPath);
            }
            if (combinations > 0)
                source += "|";
            source += toRegExpSource(tokens, delimiter, keys, data.originalPath, trailing);
            combinations++;
        });
    }
    process(path);
    let pattern = `^(?:${source})`;
    pattern += end ? "$" : "(?=" + escape(delimiter) + "|$)";
    return { regexp: new RegExp(pattern, sensitive ? "" : "i"), keys };
}
/**
 * Generate a flat list of sequence tokens from the given tokens.
 */
function flatten(tokens, index, result, callback) {
    while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "group") {
            const len = result.length;
            flatten(token.tokens, 0, result, (seq) => flatten(tokens, index, seq, callback));
            result.length = len;
            continue;
        }
        result.push(token);
    }
    callback(result);
}
/**
 * Transform a flat sequence of tokens into a regular expression.
 */
function toRegExpSource(tokens, delimiter, keys, originalPath, trailing) {
    let result = "";
    let prefix = "";
    let hasWildcardAhead = false;
    let hasSegmentWildcard = false;
    let wildcardBacktrack = "";
    let index = 0;
    function seekWildcard(index) {
        while (index < tokens.length) {
            const token = tokens[index++];
            if (token.type === "wildcard")
                return true;
        }
        return false;
    }
    function textRemaining(index) {
        let result = "";
        while (index < tokens.length) {
            const token = tokens[index++];
            if (token.type !== "text")
                return result;
            if (token.value.includes(delimiter))
                break;
            result += token.value;
        }
    }
    while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "text") {
            const value = escape(token.value);
            result += value;
            wildcardBacktrack += value;
            prefix += token.value;
            if (token.value.includes(delimiter))
                hasSegmentWildcard = false;
            continue;
        }
        if (token.type === "param" || token.type === "wildcard") {
            if (result && !prefix) {
                throw new PathError(`Missing text before "${token.name}" ${token.type}`, originalPath);
            }
            keys.push(token);
            if (token.type === "param") {
                if (hasSegmentWildcard) {
                    const value = negate(delimiter, prefix);
                    result += `(${value}+?|${value}*${escape(prefix)})`;
                }
                else {
                    const text = textRemaining(index);
                    if (text) {
                        result += `(?=(${negate(delimiter, "")}+?)${escape(text)})(?:\\${keys.length})`;
                    }
                    else {
                        result += `(${negate(delimiter, "")}+)`;
                    }
                }
            }
            else {
                // If we had a wildcard, close lookahead and reset.
                if (hasWildcardAhead)
                    result += `)${wildcardBacktrack}`;
                hasWildcardAhead = seekWildcard(index);
                // Lock earlier wildcards; leave the last one greedy.
                result += hasWildcardAhead ? "(?=([^]+?)" : "([^]+)";
                hasSegmentWildcard = true;
                wildcardBacktrack = "";
            }
            wildcardBacktrack += `(?:\\${keys.length})`;
            prefix = "";
            continue;
        }
        throw new TypeError(`Unknown token type: ${token.type}`);
    }
    if (trailing && !prefix.endsWith(delimiter)) {
        result += "(?:" + escape(delimiter) + "$)?";
    }
    return result;
}
/**
 * Block backtracking on previous text/delimiter.
 */
function negate(a, b) {
    if (b.length > a.length)
        return negate(b, a); // Longest string first.
    if (a === b)
        b = ""; // Cleaner regex strings, no duplication.
    if (b.length > 1)
        return `(?:(?!${escape(a)}|${escape(b)})[^])`;
    if (a.length > 1)
        return `(?:(?!${escape(a)})[^${escape(b)}])`;
    return `[^${escape(a + b)}]`;
}
/**
 * Stringify token data into a path string.
 */
export function stringify(data) {
    const { tokens } = data;
    let index = 0;
    let value = "";
    while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "text") {
            value += escapeText(token.value);
            continue;
        }
        if (token.type === "group") {
            value += "{" + stringify(token) + "}";
            continue;
        }
        if (token.type === "param") {
            value += ":" + stringifyName(token.name, tokens, index);
            continue;
        }
        if (token.type === "wildcard") {
            value += "*" + stringifyName(token.name, tokens, index);
            continue;
        }
        throw new TypeError(`Unknown token type: ${token.type}`);
    }
    return value;
}
/**
 * Wrap a parameter name in quotes, escaping only the characters the parser
 * treats specially inside a quoted name (`"` and `\`). `JSON.stringify` can't
 * be used here because it emits escapes like `\n` that the parser reads back as
 * the literal character `n`, so names with control characters wouldn't survive
 * a `parse` -> `stringify` -> `parse` round trip.
 */
function quoteName(name) {
    return `"${name.replace(/["\\]/g, "\\$&")}"`;
}
/**
 * Stringify a parameter name, escaping when it cannot be emitted directly.
 */
function stringifyName(name, tokens, index) {
    if (!ID.test(name))
        return quoteName(name);
    while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "text") {
            if (!token.value)
                continue;
            // Destructuring reads the first *code point*, matching `parse`, which
            // iterates the path with `[...str]`. Indexing with `[0]` would read only the
            // leading surrogate of an astral character, missing that the parser treats
            // the whole character as `ID_Continue` and absorbs it into the name.
            const [first] = token.value;
            if (ID_CONTINUE.test(first))
                return quoteName(name);
        }
        break;
    }
    return name;
}
//# sourceMappingURL=index.js.map