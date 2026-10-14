const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Describes imports, character encoding, URL references, and local problems.
 * @param {string} source - Original stylesheet source
 * @returns {Object} Structural parse result with original-source ranges
 */
export function parseStylesheet(source) {
    return new StylesheetParser(source).parse();
}

/**
 * Renders a parsed stylesheet while stripping comments and rewriting URLs.
 * @param {Object} args - Rendering options
 * @param {string} args.source - Original stylesheet source
 * @param {Object} args.parsed - Result returned by parseStylesheet
 * @param {string} args.pathname - Root-relative logical stylesheet pathname
 * @param {Function} args.replaceImport - Returns text for each parsed import
 * @returns {string} Rendered stylesheet source
 */
export function renderStylesheet(args) {
    const { source, parsed, pathname, replaceImport } = args ?? {};
    const edits = [];

    for (const comment of parsed.comments) {
        edits.push({ ...comment, replacement: '', priority: 0 });
    }

    for (const reference of parsed.urls) {
        if (reference.kind !== 'relative' || !reference.canRewrite) {
            continue;
        }

        const resolved = new URL(reference.value, `http://x${pathname}`);
        const value = resolved.pathname + resolved.search + resolved.hash;
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        edits.push({
            start: reference.start,
            end: reference.end,
            replacement: `url("${escaped}")`,
            priority: 1,
        });
    }

    for (const statement of parsed.imports) {
        edits.push({
            start: statement.start,
            end: statement.end,
            replacement: replaceImport(statement),
            priority: 2,
        });
    }

    edits.sort((left, right) => {
        return left.start - right.start || right.priority - left.priority;
    });

    let output = '';
    let position = 0;

    for (const edit of edits) {
        if (edit.start < position) {
            continue;
        }

        output += source.slice(position, edit.start) + edit.replacement;
        position = edit.end;
    }

    return output + source.slice(position);
}

class StylesheetParser {
    #source;
    #position = 0;
    #depth = 0;
    #hasSignificantContent = false;
    #imports = [];
    #charset = null;
    #urls = [];
    #comments = [];
    #problems = [];

    constructor(source) {
        this.#source = source;
    }

    parse() {
        while (this.#position < this.#source.length) {
            if (this.#readComment()) {
                continue;
            }

            const character = this.#source[this.#position];

            if (character === '"' || character === "'") {
                this.#hasSignificantContent = true;
                this.#position = findStringEnd(
                    this.#source,
                    this.#position,
                    character,
                );
                continue;
            }

            if (character === '{') {
                this.#depth += 1;
                this.#hasSignificantContent = true;
                this.#position += 1;
                continue;
            }

            if (character === '}') {
                this.#depth = Math.max(0, this.#depth - 1);
                this.#hasSignificantContent = true;
                this.#position += 1;
                continue;
            }

            if (character === '@' && this.#readAtRule()) {
                continue;
            }

            if (isIdentifierStart(character) && this.#readFunction()) {
                this.#hasSignificantContent = true;
                continue;
            }

            if (!isWhitespace(character)) {
                this.#hasSignificantContent = true;
            }

            this.#position += 1;
        }

        return {
            imports: this.#imports,
            charset: this.#charset,
            urls: this.#urls,
            comments: this.#comments,
            hasSignificantContent: this.#hasSignificantContent,
            problems: this.#problems,
        };
    }

    #readComment() {
        if (!this.#source.startsWith('/*', this.#position)) {
            return false;
        }

        const start = this.#position;
        const closing = this.#source.indexOf('*/', start + 2);
        const end = closing === -1 ? this.#source.length : closing + 2;
        this.#comments.push({ start, end });
        this.#position = end;
        return true;
    }

    #readAtRule() {
        const match = /^@([a-z-]+)/i.exec(this.#source.slice(this.#position));

        if (!match) {
            return false;
        }

        const name = match[1].toLowerCase();

        if (name === 'import') {
            this.#readImport(match[0].length);
            return true;
        }

        if (name === 'charset') {
            this.#readCharset(match[0].length);
            return true;
        }

        if (name === 'layer' && this.#depth === 0) {
            const end = findStatementEnd(this.#source, this.#position);

            if (end !== null) {
                this.#collectComments(this.#position, end);
                this.#position = end;
                return true;
            }
        }

        return false;
    }

    #readImport(keywordLength) {
        const start = this.#position;
        let position = start + keywordLength;
        const hasRequiredWhitespace = isWhitespace(this.#source[position]);
        position = skipWhitespaceAndComments(this.#source, position);
        const specifierResult = hasRequiredWhitespace
            ? readImportSpecifier(this.#source, position)
            : null;
        const terminator = findImportTerminator(
            this.#source,
            specifierResult?.end ?? position,
        );

        if (!specifierResult || terminator.character !== ';') {
            this.#addProblem(
                'css-import-invalid',
                start,
                'Invalid CSS import statement',
            );
            this.#hasSignificantContent = true;
            this.#position = start + keywordLength;
            return;
        }

        const condition = this.#source
            .slice(specifierResult.end, terminator.position)
            .trim();
        const importStatement = {
            start,
            end: terminator.position + 1,
            ...getPosition(this.#source, start),
            specifier: specifierResult.value,
            form: specifierResult.form,
            quote: specifierResult.quote,
            kind: classifyReference(specifierResult.value),
            condition,
            isConditioned: removeComments(condition).trim().length > 0,
            hasSignificantContentBefore: this.#hasSignificantContent,
        };
        this.#imports.push(importStatement);

        if (this.#depth > 0 || this.#hasSignificantContent) {
            this.#addProblem(
                'css-import-misplaced',
                start,
                'CSS import must precede significant content',
            );
        }

        this.#position = terminator.position + 1;
    }

    #readCharset(keywordLength) {
        const start = this.#position;
        const end = findStatementEnd(this.#source, start);
        const statementEnd = end ?? this.#source.length;
        const statement = this.#source.slice(start + keywordLength, statementEnd);
        const match = /^\s*(["'])([^"']*)\1\s*;$/i.exec(statement);
        const isLeading = start === 0;
        const isUtf8 = match && match[2].toLowerCase() === 'utf-8';

        if (isLeading && isUtf8) {
            this.#charset = {
                start,
                end: statementEnd,
                ...getPosition(this.#source, start),
                value: match[2],
            };
        } else {
            const message = isLeading
                ? 'CSS charset must be UTF-8'
                : 'CSS charset must come first and be UTF-8';
            this.#addProblem('css-charset-unsupported', start, message);
        }

        this.#position = statementEnd;
    }

    #readFunction() {
        const previous = this.#source[this.#position - 1];

        if (isIdentifierCharacter(previous)) {
            return false;
        }

        const match = /^([a-z-]+)\s*\(/i.exec(this.#source.slice(this.#position));

        if (!match) {
            return false;
        }

        const name = match[1].toLowerCase();

        if (name === 'url') {
            this.#readUrl(this.#position, match[0].length);
            return true;
        }

        if (name === 'image-set' || name === '-webkit-image-set') {
            this.#readImageSet(this.#position, match[0].length);
            return true;
        }

        return false;
    }

    #readUrl(start, openingLength) {
        const result = readUrl(this.#source, start, openingLength);

        if (!result) {
            this.#position = start + openingLength;
            return;
        }

        this.#urls.push({
            start,
            end: result.end,
            ...getPosition(this.#source, start),
            value: result.value,
            kind: classifyReference(result.value),
            canRewrite: result.canRewrite,
        });
        this.#position = result.end;
    }

    #readImageSet(start, openingLength) {
        let position = start + openingLength;
        let parentheses = 1;

        while (position < this.#source.length && parentheses > 0) {
            if (this.#source.startsWith('/*', position)) {
                const closing = this.#source.indexOf('*/', position + 2);
                const end = closing === -1 ? this.#source.length : closing + 2;
                this.#comments.push({ start: position, end });
                position = end;
                continue;
            }

            const character = this.#source[position];

            if (character === '"' || character === "'") {
                const end = findStringEnd(this.#source, position, character);
                const value = decodeCssString(
                    this.#source.slice(position + 1, Math.max(position + 1, end - 1)),
                );

                if (classifyReference(value) === 'relative') {
                    this.#addProblem(
                        'css-url-invalid',
                        position,
                        'Relative image-set strings must use url()',
                    );
                }

                position = end;
                continue;
            }

            const urlMatch = /^url\s*\(/i.exec(this.#source.slice(position));

            if (urlMatch) {
                this.#position = position;
                this.#readUrl(position, urlMatch[0].length);
                position = this.#position;
                continue;
            }

            if (character === '(') {
                parentheses += 1;
            } else if (character === ')') {
                parentheses -= 1;
            }

            position += 1;
        }

        this.#position = position;
    }

    #addProblem(code, position, message) {
        const location = getPosition(this.#source, position);
        this.#problems.push({
            code,
            ...location,
            message: `${message} at ${location.line}:${location.column}`,
        });
    }

    #collectComments(start, end) {
        let position = start;

        while (position < end) {
            const opening = this.#source.indexOf('/*', position);

            if (opening === -1 || opening >= end) {
                return;
            }

            const closing = this.#source.indexOf('*/', opening + 2);
            const commentEnd = closing === -1 ? end : Math.min(end, closing + 2);
            this.#comments.push({ start: opening, end: commentEnd });
            position = commentEnd;
        }
    }
}

function readImportSpecifier(source, position) {
    const character = source[position];

    if (character === '"' || character === "'") {
        const end = findStringEnd(source, position, character);

        if (end > source.length || source[end - 1] !== character) {
            return null;
        }

        return {
            value: decodeCssString(source.slice(position + 1, end - 1)),
            end,
            form: 'string',
            quote: character,
        };
    }

    const match = /^url\s*\(/i.exec(source.slice(position));

    if (!match) {
        return null;
    }

    const result = readUrl(source, position, match[0].length);
    return result ? { ...result, form: 'url', quote: result.quote } : null;
}

function readUrl(source, start, openingLength) {
    let position = skipWhitespace(source, start + openingLength);
    const quote = source[position];
    let value;

    if (quote === '"' || quote === "'") {
        const end = findStringEnd(source, position, quote);

        if (source[end - 1] !== quote) {
            return null;
        }

        value = decodeCssString(source.slice(position + 1, end - 1));
        position = skipWhitespace(source, end);
    } else {
        const valueStart = position;

        while (position < source.length && source[position] !== ')') {
            if (source[position] === '\\') {
                position += 2;
                continue;
            }
            position += 1;
        }

        value = decodeCssString(source.slice(valueStart, position).trim());
    }

    if (source[position] !== ')') {
        return null;
    }

    return {
        value,
        end: position + 1,
        quote: quote === '"' || quote === "'" ? quote : null,
        canRewrite: !source.slice(start, position + 1).includes('/*'),
    };
}

function findImportTerminator(source, start) {
    let position = start;
    let parentheses = 0;

    while (position < source.length) {
        const character = source[position];

        if (character === '"' || character === "'") {
            position = findStringEnd(source, position, character);
            continue;
        }

        if (source.startsWith('/*', position)) {
            const closing = source.indexOf('*/', position + 2);
            position = closing === -1 ? source.length : closing + 2;
            continue;
        }

        if (character === '(') {
            parentheses += 1;
        } else if (character === ')') {
            parentheses = Math.max(0, parentheses - 1);
        } else if (parentheses === 0 && (character === ';' || character === '{')) {
            return { character, position };
        }

        position += 1;
    }

    return { character: '', position: source.length };
}

function findStatementEnd(source, start) {
    const result = findImportTerminator(source, start);
    return result.character === ';' ? result.position + 1 : null;
}

function findStringEnd(source, start, quote) {
    let position = start + 1;

    while (position < source.length) {
        if (source[position] === '\\') {
            position += 2;
            continue;
        }
        if (source[position] === quote) {
            return position + 1;
        }
        position += 1;
    }

    return source.length + 1;
}

function skipWhitespace(source, start) {
    let position = start;

    while (position < source.length && isWhitespace(source[position])) {
        position += 1;
    }

    return position;
}

function skipWhitespaceAndComments(source, start) {
    let position = start;

    while (position < source.length) {
        const next = skipWhitespace(source, position);

        if (!source.startsWith('/*', next)) {
            return next;
        }

        const closing = source.indexOf('*/', next + 2);
        position = closing === -1 ? source.length : closing + 2;
    }

    return position;
}

function decodeCssString(value) {
    return value.replace(/\\([\s\S])/g, '$1');
}

function classifyReference(value) {
    if (value.length === 0) {
        return 'empty';
    }
    if (value.startsWith('//') || SCHEME_PATTERN.test(value)) {
        return 'external';
    }
    if (value.startsWith('/')) {
        return 'root-relative';
    }
    if (value.startsWith('#')) {
        return 'fragment';
    }
    return 'relative';
}

function removeComments(value) {
    return value.replace(/\/\*[\s\S]*?\*\//g, '');
}

function getPosition(source, position) {
    const preceding = source.slice(0, position);
    const lines = preceding.split(/\r\n|\r|\n/);
    return { line: lines.length, column: lines[lines.length - 1].length };
}

function isIdentifierStart(character) {
    return Boolean(character && /[a-z-]/i.test(character));
}

function isIdentifierCharacter(character) {
    return Boolean(character && /[a-z0-9_-]/i.test(character));
}

function isWhitespace(character) {
    return /\s/.test(character);
}
