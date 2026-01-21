/**
 * @fileoverview Simple glob pattern matcher that converts glob patterns to regular expressions
 *
 * Supports common glob syntax:
 * - `*` matches any characters except path separator
 * - `**` matches any characters including path separator
 * - `?` matches a single character
 * - `{a,b}` matches either a or b
 */

import { isNonEmptyString } from '../assertions/mod.js';

export default class GlobMatcher {

    /**
     * @type {RegExp}
     * @private
     */
    #regex = null;

    /**
     * Creates a new GlobMatcher instance
     * @param {string} pattern - The glob pattern to compile
     * @throws {Error} When pattern is not a non-empty string
     */
    constructor(pattern) {
        if (!isNonEmptyString(pattern)) {
            throw new Error('GlobMatcher pattern must be a non-empty string');
        }

        this.#regex = this.#compilePattern(pattern);

        Object.defineProperties(this, {
            /**
             * The original glob pattern
             * @memberof GlobMatcher#
             * @type {string}
             * @readonly
             */
            pattern: {
                enumerable: true,
                value: pattern,
            },
        });
    }

    /**
     * Tests whether a filepath matches the glob pattern
     * @param {string} filepath - The filepath to test
     * @returns {boolean} True if the filepath matches the pattern
     */
    matches(filepath) {
        return this.#regex.test(filepath);
    }

    /**
     * Compiles a glob pattern into a regular expression
     * @private
     * @param {string} pattern - The glob pattern to compile
     * @returns {RegExp} The compiled regular expression
     */
    #compilePattern(pattern) {
        let regexStr = '';
        let i = 0;

        while (i < pattern.length) {
            const char = pattern[i];

            if (char === '*') {
                // Check for ** (globstar)
                if (pattern[i + 1] === '*') {
                    // ** matches any characters including path separators
                    regexStr += '.*';
                    i += 2;
                } else {
                    // * matches any characters except path separator
                    regexStr += '[^/]*';
                    i += 1;
                }
            } else if (char === '?') {
                // ? matches a single character (except path separator)
                regexStr += '[^/]';
                i += 1;
            } else if (char === '{') {
                // {a,b} matches either a or b
                const closeIndex = pattern.indexOf('}', i);
                if (closeIndex === -1) {
                    // No closing brace, treat as literal
                    regexStr += '\\{';
                    i += 1;
                } else {
                    const alternatives = pattern.slice(i + 1, closeIndex).split(',');
                    regexStr += '(' + alternatives.map((alt) => this.#escapeRegex(alt)).join('|') + ')';
                    i = closeIndex + 1;
                }
            } else if (char === '[') {
                // Character class - find the closing bracket
                const closeIndex = pattern.indexOf(']', i);
                if (closeIndex === -1) {
                    // No closing bracket, treat as literal
                    regexStr += '\\[';
                    i += 1;
                } else {
                    // Pass through character class as-is
                    regexStr += pattern.slice(i, closeIndex + 1);
                    i = closeIndex + 1;
                }
            } else {
                // Escape special regex characters
                regexStr += this.#escapeRegex(char);
                i += 1;
            }
        }

        return new RegExp('^' + regexStr + '$');
    }

    /**
     * Escapes special regex characters in a string
     * @private
     * @param {string} str - The string to escape
     * @returns {string} The escaped string
     */
    #escapeRegex(str) {
        return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
}
