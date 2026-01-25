/**
 * Converts a URN pattern with wildcards into a RegExp for matching URN strings.
 *
 * The "*" wildcard matches any single segment (characters between colons), but does
 * not match across segment boundaries.
 *
 * @param {string} pattern - URN pattern with optional "*" wildcards (e.g., "urn:kixx:users:*")
 * @returns {RegExp} Anchored regular expression for exact URN matching
 *
 * @example
 * const regex = urnPatternToRegexp("urn:kixx:*:read");
 * regex.test("urn:kixx:posts:read");          // true
 * regex.test("urn:kixx:posts:comments:read"); // false (wildcard matches single segment only)
 */
export default function urnPatternToRegexp(pattern) {
    const segments = pattern.split(':');

    const regexSegments = segments.map((segment) => {
        if (segment === '*') {
            return '[^:]*';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

    const regexPattern = '^' + regexSegments.join(':') + '$';

    return new RegExp(regexPattern);
}
