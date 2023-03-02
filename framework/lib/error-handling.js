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
    return err.code && err.title;
}

/**
 * @param  {String} message
 * @param  {Error|KixxError|unknown} cause
 * @return {KixxError|null}
 */
export function errorToStackedError(message, cause) {
    if (!cause) {
        return null;
    }

    if (isStackedError(cause)) {
        // @ts-ignore error TS2740: Type '{}' is missing the following properties from type 'KixxError':
        return cause;
    }

    let newMessage;

    // @ts-ignore error TS2339: Property 'code' does not exist on type '{}'
    if (cause.code) {
        // @ts-ignore error TS2339: Property 'message' does not exist on type '{}'
        newMessage = message || cause.message || 'Unknown operational error';
        return new OperationalError(newMessage, { cause }, errorToStackedError);
    }

    // @ts-ignore error TS2339: Property 'message' does not exist on type '{}'
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
