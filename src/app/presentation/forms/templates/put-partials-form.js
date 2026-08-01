import {
    isNonEmptyString,
    isPlainObject,
    isString,
} from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isValidPathname } from '../../../../kixx/utils/validate-pathname.js';


/**
 * Normalizes and validates a complete partial-template-set publication payload.
 *
 * Filepaths are relative to the `partials/` prefix and are validated with the
 * same safe-path rules as the retired per-file wildcard route (no traversal, no
 * empty/leading/trailing/doubled slash segments, no disallowed characters)
 * before being folded to lower case to match Hyperview's canonical,
 * case-insensitive partial addressing. Sources are preserved verbatim after
 * JSON decoding; neither field is trimmed. An empty `partials` array is a
 * valid, complete (empty) set.
 */
export default class PutPartialsForm {

    /**
     * JSON Schema for the accepted complete partial-set attributes.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            partials: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        filepath: { type: 'string' },
                        source: { type: 'string' },
                    },
                    required: [ 'filepath', 'source' ],
                },
            },
        },
        required: [ 'partials' ],
    };

    /**
     * @param {Object} [attributes] - JSON:API partial-set attributes.
     * @param {*} [attributes.partials] - Submitted partial entries.
     */
    constructor(attributes) {
        const { partials } = attributes ?? {};

        // Normalize shape only; keep invalid input intact for validate(). A
        // non-array `partials` is left as-is (rather than coerced to []) so
        // validate() can report it as a shape error.
        this.partials = Array.isArray(partials) ? partials.map(normalizePartialEntry) : partials;
    }

    /**
     * Validates the normalized partial entries: overall shape, safe non-empty
     * filepaths, non-empty sources, and post-normalization duplicate filepaths.
     * An empty `partials` array is valid and reports no errors.
     * @returns {void}
     * @throws {ValidationError} When the batch or an entry is invalid.
     */
    validate() {
        const error = new ValidationError('The partial template set contains invalid fields');

        if (!Array.isArray(this.partials)) {
            error.push('partials must be an array', 'partials');
            throw error;
        }

        const seenFilepaths = new Set();

        this.partials.forEach((entry, index) => {
            const { filepath, source } = entry ?? {};
            const fieldPrefix = `partials[${ index }]`;

            if (!isValidPartialFilepath(filepath)) {
                error.push(
                    'filepath must be a non-empty, safe path relative to partials/',
                    `${ fieldPrefix }.filepath`,
                );
            } else if (seenFilepaths.has(filepath)) {
                error.push(
                    `filepath "${ filepath }" collides with another entry after normalization`,
                    `${ fieldPrefix }.filepath`,
                );
            } else {
                seenFilepaths.add(filepath);
            }

            if (!isNonEmptyString(source)) {
                error.push('source is required', `${ fieldPrefix }.source`);
            }
        });

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns the normalized partial entries consumed by the Transaction Script.
     * @returns {{ partials: {filepath: string, source: string}[] }} Plain JSON form values.
     */
    toJSON() {
        return { partials: this.partials };
    }

    /**
     * Creates the form from a parsed JSON:API resource.
     * @param {{ attributes: Object }} resource - Parsed resource from resourceFromJsonApiDocument().
     * @returns {PutPartialsForm} Hydrated partial-set form.
     */
    static fromJsonApi(resource) {
        const { attributes } = resource ?? {};
        return new PutPartialsForm(attributes);
    }
}

function normalizePartialEntry(rawEntry) {
    const { filepath, source } = isPlainObject(rawEntry) ? rawEntry : {};

    return {
        // Fold to lower case only when it is safe to do so; validate() reports
        // an unsafe or non-string filepath rather than this normalization step
        // silently discarding it.
        filepath: isString(filepath) && isValidPartialFilepath(filepath) ? filepath.toLowerCase() : filepath,
        source,
    };
}

// A leading, trailing, or doubled slash produces an empty path segment; JSON:API
// input arrives as one string rather than the pre-split route segments the
// retired wildcard route validated, so that check is reproduced here.
function isValidPartialFilepath(filepath) {
    if (!isNonEmptyString(filepath)) {
        return false;
    }

    if (filepath.split('/').some((segment) => segment.length === 0)) {
        return false;
    }

    return isValidPathname(filepath);
}
