import { EOL } from 'node:os';


/**
 * Recursively walk an Error object, looking for a stack trace string
 * as `.stack` for each discovered cause. An Error object may have nested
 * causes, which are also expected to be Error instances, like
 * `err.cause.cause.cause`. The resulting stack trace from the error and
 * all child causes is concatenated together, delineated by "caused by:".
 *
 * @param  {Error}
 * @return {string}
 */
export function getFullStack(err) {
    if (!err) {
        return 'Null or undefined error';
    }

    // Start recursively walking the Error, using the passed in Error as
    // the first cause.
    const stack = recursivelyConcat([], err);

    return stack.join(`${ EOL }caused by:${ EOL }`);
}

/**
 * Builds a stack trace Array of strings by recursively inpecting all the
 * descendant `.cause` attributes for stack trace strings.
 *
 * @private
 *
 * @param  {Array}
 * @param  {Error}
 * @return {Array} Returns the same Array which was passed in by reference.
 */
function recursivelyConcat(stack, cause) {
    if (cause && cause.stack && typeof cause.stack === 'string') {
        stack.push(cause.stack);
    } else {
        stack.push('No stack trace');
    }

    if (cause && cause.cause) {
        return recursivelyConcat(stack, cause.cause);
    }

    return stack;
}
