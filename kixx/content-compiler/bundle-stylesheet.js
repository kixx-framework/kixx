import { isValidPathname } from './content-layout.js';
import {
    parseStylesheet,
    renderStylesheet,
} from './parse-stylesheet.js';

/**
 * Flattens local CSS imports and reports graph-level stylesheet problems.
 * @param {Object} args - Bundle options
 * @param {string} args.entryPathname - Root-relative logical entry pathname
 * @param {Function} args.getStylesheet - Looks up source text by logical pathname
 * @returns {Object} Bundled source, contributing source files, and problems
 */
export function bundleStylesheet(args) {
    const { entryPathname, getStylesheet } = args ?? {};
    return new StylesheetBundler(entryPathname, getStylesheet).bundle();
}

class StylesheetBundler {
    #entryPathname;
    #getStylesheet;
    #stylesheets = new Map();
    #reportedFiles = new Set();
    #sourceFileSet = new Set();
    #sourceFiles = [];
    #problems = [];
    #activePathnames = [];
    #hasEmittedSignificantContent = false;

    constructor(entryPathname, getStylesheet) {
        this.#entryPathname = entryPathname;
        this.#getStylesheet = getStylesheet;
    }

    bundle() {
        const entry = this.#getParsedStylesheet(this.#entryPathname);

        if (!entry) {
            return {
                source: '',
                sourceFiles: [],
                problems: [],
            };
        }

        const source = this.#renderStylesheet(this.#entryPathname, entry, true);

        return {
            source,
            sourceFiles: this.#sourceFiles,
            problems: this.#problems,
        };
    }

    #renderStylesheet(pathname, stylesheet, isEntry) {
        this.#recordStylesheet(pathname, stylesheet);
        this.#activePathnames.push(pathname);

        let source = renderStylesheet({
            source: stylesheet.text,
            parsed: stylesheet.parsed,
            pathname,
            replaceImport: (statement) => {
                return this.#replaceImport(pathname, stylesheet, statement);
            },
        });

        this.#activePathnames.pop();

        if (!isEntry && stylesheet.parsed.charset) {
            source = source.slice(stylesheet.parsed.charset.end);
        }

        if (stylesheet.parsed.hasSignificantContent) {
            this.#hasEmittedSignificantContent = true;
        }

        return isEntry ? source : ensureTrailingNewline(source);
    }

    #replaceImport(pathname, stylesheet, statement) {
        if (statement.hasSignificantContentBefore) {
            this.#hasEmittedSignificantContent = true;
        }

        if (statement.kind === 'external') {
            this.#checkKeptImportPlacement(stylesheet, statement);
            return stylesheet.text.slice(statement.start, statement.end);
        }

        const resolved = resolveImport(pathname, statement.specifier);

        if (!resolved.pathname) {
            this.#addImportProblem(
                'css-import-invalid',
                stylesheet,
                statement,
                resolved.reason,
            );
            return '';
        }

        const target = this.#getParsedStylesheet(resolved.pathname);

        if (!target) {
            this.#addImportProblem(
                'css-import-missing',
                stylesheet,
                statement,
                `CSS import target "${ resolved.pathname }" was not found`,
            );

            if (statement.isConditioned) {
                this.#checkKeptImportPlacement(stylesheet, statement);
                return formatConditionedImport(
                    resolved.pathname,
                    statement.condition,
                );
            }

            return '';
        }

        if (statement.isConditioned) {
            this.#checkKeptImportPlacement(stylesheet, statement);
            return formatConditionedImport(resolved.pathname, statement.condition);
        }

        const cycleStart = this.#activePathnames.indexOf(resolved.pathname);

        if (cycleStart !== -1) {
            const importChain = [
                ...this.#activePathnames,
                resolved.pathname,
            ];
            this.#problems.push({
                code: 'css-import-cycle',
                filepath: stylesheet.sourcePath,
                line: statement.line,
                column: statement.column,
                entry: this.#entryPathname,
                importChain,
                message: `CSS import cycle for entry "${ this.#entryPathname }": ${ importChain.join(' -> ') } at ${ statement.line }:${ statement.column }`,
            });
            return '';
        }

        return this.#renderStylesheet(resolved.pathname, target, false);
    }

    #getParsedStylesheet(pathname) {
        if (this.#stylesheets.has(pathname)) {
            return this.#stylesheets.get(pathname);
        }

        const source = this.#getStylesheet(pathname);
        const stylesheet = source ? {
            ...source,
            parsed: parseStylesheet(source.text),
        } : null;
        this.#stylesheets.set(pathname, stylesheet);
        return stylesheet;
    }

    #recordStylesheet(pathname, stylesheet) {
        if (!this.#sourceFileSet.has(stylesheet.sourcePath)) {
            this.#sourceFileSet.add(stylesheet.sourcePath);
            this.#sourceFiles.push(stylesheet.sourcePath);
        }

        if (this.#reportedFiles.has(pathname)) {
            return;
        }

        this.#reportedFiles.add(pathname);

        for (const problem of stylesheet.parsed.problems) {
            this.#problems.push({
                ...problem,
                filepath: stylesheet.sourcePath,
            });
        }
    }

    #checkKeptImportPlacement(stylesheet, statement) {
        if (!this.#hasEmittedSignificantContent ||
            statement.hasSignificantContentBefore) {
            return;
        }

        const importChain = [ ...this.#activePathnames ];
        this.#problems.push({
            code: 'css-import-misplaced',
            filepath: stylesheet.sourcePath,
            line: statement.line,
            column: statement.column,
            entry: this.#entryPathname,
            importChain,
            message: `CSS import in entry "${ this.#entryPathname }" follows bundled content through ${ importChain.join(' -> ') } at ${ statement.line }:${ statement.column }`,
        });
    }

    #addImportProblem(code, stylesheet, statement, message) {
        this.#problems.push({
            code,
            filepath: stylesheet.sourcePath,
            line: statement.line,
            column: statement.column,
            message: `${ message } at ${ statement.line }:${ statement.column }`,
        });
    }
}

function resolveImport(importerPathname, specifier) {
    if (specifier.length === 0) {
        return { reason: 'CSS import specifier must not be empty' };
    }

    if (specifier.includes('?') || specifier.includes('#')) {
        return { reason: 'CSS import must not contain a query or fragment' };
    }

    if (!specifier.startsWith('/') && climbsAboveRoot(importerPathname, specifier)) {
        return { reason: 'CSS import must not climb above the site root' };
    }

    const resolved = new URL(specifier, `http://x${ importerPathname }`);
    const pathname = resolved.pathname;

    if (!isValidPathname(pathname)) {
        return { reason: `CSS import pathname "${ pathname }" is invalid` };
    }

    if (!pathname.endsWith('.css')) {
        return { reason: `CSS import pathname "${ pathname }" must end in .css` };
    }

    return { pathname };
}

function climbsAboveRoot(importerPathname, specifier) {
    const directoryParts = importerPathname.split('/').slice(1, -1);
    let decodedSpecifier = specifier;

    try {
        decodedSpecifier = decodeURIComponent(specifier);
    } catch {
        // The resolved pathname retains malformed escapes for validation.
    }

    let depth = directoryParts.length;

    for (const part of decodedSpecifier.split('/')) {
        if (part === '' || part === '.') {
            continue;
        }
        if (part === '..') {
            depth -= 1;

            if (depth < 0) {
                return true;
            }
            continue;
        }

        depth += 1;
    }

    return false;
}

function formatConditionedImport(pathname, condition) {
    const suffix = condition.length > 0 ? ` ${ condition }` : '';
    return `@import "${ escapeCssString(pathname) }"${ suffix };`;
}

function escapeCssString(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function ensureTrailingNewline(source) {
    return source.endsWith('\n') ? source : source + '\n';
}
