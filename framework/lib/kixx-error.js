export default class KixxError extends Error {

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
