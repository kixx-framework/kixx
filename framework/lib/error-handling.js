// @ts-check

import KixxAssert from 'kixx-assert';

// These imports are for type checking.
// eslint-disable-next-line no-unused-vars
import KixxError from './kixx-error.js';

const { isNumber } = KixxAssert.helpers;

/**
 * @param  {KixxError} err
 * @return {number}
 */
export function getHttpStatusCode(err) {

    function recursivelyCheckError(cause) {
        if (isNumber(cause.statusCode)) {
            return cause.statusCode;
        }

        if (cause.cause) {
            return recursivelyCheckError(cause.cause);
        }

        return 0;
    }

    if (err) {
        return recursivelyCheckError(err);
    }

    return 0;
}
