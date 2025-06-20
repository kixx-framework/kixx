import WrappedError from './wrapped-error.js';


/**
 * A ValidationError is particularly useful when multiple validations fail
 * as it makes the ValidationError:errors Array availble and provides
 * the .push() method.
 */
export default class ValidationError extends WrappedError {
    static CODE = 'VALIDATION_ERROR';
    static HTTP_STATUS_CODE = 422;

    errors = [];

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }

    /**
     * @return {number} The length of the .errors Array.
     */
    get length() {
        return this.errors.length;
    }

    /**
     * Push a new validation failure error onto the .errors Array. This will
     * create a new Error instance and push it onto the .errors Array.
     * @param  {string}
     * @param  {string} The property path which caused the validation to fail.
     */
    push(message, source) {
        this.errors.push({
            message,
            source,
        });
    }
}
