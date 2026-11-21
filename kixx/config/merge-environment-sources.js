import {
    assert,
    assertArray,
    assertNonEmptyString,
    isObjectNotNull,
    isUndefined,
} from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';


/**
 * @typedef {Object} EnvironmentSource
 * @property {string} name - Identifies the source in duplicate-key error messages
 * @property {Object} [values] - Environment variables contributed by the source
 */

/**
 * Merges named environment sources into one flat object, rejecting any key
 * defined by more than one source.
 *
 * A duplicate key is treated as a deployment misconfiguration rather than a
 * precedence question: there is no rule for which source wins, because a key
 * carrying two definitions means one of them is in the wrong place. Failing
 * here is what keeps a secret placed in a plain-text source, or left exported
 * in a shell, from being silently resolved away.
 *
 * Only keys the sources actually declare participate, so unrelated process
 * environment entries never collide.
 *
 * @param {EnvironmentSource[]} sources - Sources in declaration order; order does not affect the result
 * @returns {Object} A null-prototype object holding the union of every source's values
 * @throws {OperationalError} When any key is defined by more than one source
 */
export function mergeEnvironmentSources(sources) {
    assertArray(sources, 'mergeEnvironmentSources: sources');

    // Environment keys come from files and the process environment, so a key
    // named "__proto__" would poison Object.prototype through a normal object
    // literal. A null prototype makes every key an ordinary own property.
    const merged = Object.create(null);

    // Track which sources defined each key so a collision error can name both
    // sides instead of only reporting that one exists.
    const sourceNamesByKey = new Map();

    for (const source of sources) {
        const { name, values } = source ?? {};

        assertNonEmptyString(name, 'mergeEnvironmentSources: source.name');
        // Deliberately not isPlainObject: process.env is an exotic host object
        // with neither Object.prototype nor a null prototype, and Object.entries
        // is the only capability this function needs from a source.
        assert(
            isUndefined(values) || isObjectNotNull(values),
            'mergeEnvironmentSources: source.values must be an object',
        );

        for (const [ key, value ] of Object.entries(values ?? {})) {
            const definedBy = sourceNamesByKey.get(key);

            if (isUndefined(definedBy)) {
                sourceNamesByKey.set(key, [ name ]);
            } else {
                definedBy.push(name);
            }

            merged[key] = value;
        }
    }

    // Report every duplicate at once. Misplaced keys usually arrive in related
    // groups, and reporting one per startup would force a boot cycle for each.
    const duplicates = [];

    for (const [ key, names ] of sourceNamesByKey) {
        if (names.length > 1) {
            duplicates.push(`${ key } (defined in ${ names.join(' and ') })`);
        }
    }

    if (duplicates.length > 0) {
        throw new OperationalError(
            `Environment variables must be defined by exactly one source: ${ duplicates.join('; ') }`,
            {},
            mergeEnvironmentSources,
        );
    }

    return merged;
}
