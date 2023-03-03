// @ts-check

import { OperationalError, ProgrammerError } from 'kixx-server-errors';
import KixxAssert from 'kixx-assert';

const { isNumber } = KixxAssert.helpers;


export class KixxError extends Error {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {String}
     */
    message;

    /**
     * @type {String}
     */
    code;

    /**
     * @type {String}
     */
    title;

    /**
     * @type {Boolean}
     */
    fatal = false;

    /**
     * @type {Error}
     */
    cause;

    /**
     * @type {Object}
     */
    info = {};

    /**
     * @type {Number}
     */
    statusCode = 0;

    /**
     * @type {Array}
     */
    unprocessableErrors = [];
}

export function isStackedError(err) {
    return err && err.code && err.title;
}

export function isInternalServerError(err) {
    err = err || {};

    if (isNumber(err.statusCode) && err.statusCode < 500) {
        return false;
    }

    return true;
}

/**
 * @param  {String} message
 * @param  {Error|KixxError} cause
 * @return {KixxError}
 */
export function errorToStackedError(message, cause) {
    if (isStackedError(cause)) {
        // @ts-ignore error TS2322: Type 'KixxError | Error' is not assignable to type 'KixxError'.
        return cause;
    }

    let newMessage;

    // @ts-ignore error TS2339: Property 'code' does not exist on type 'KixxError | Error'
    if (cause && cause.code) {
        newMessage = message || cause.message || 'Unknown operational error';
        return new OperationalError(newMessage, { cause }, errorToStackedError);
    }

    newMessage = message || cause.message || 'Unknown programmer error';
    return new ProgrammerError(newMessage, { cause, fatal: true }, errorToStackedError);
}

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
