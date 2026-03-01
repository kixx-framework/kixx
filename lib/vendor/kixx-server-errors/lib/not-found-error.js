import WrappedError from './wrapped-error.js';


export default class NotFoundError extends WrappedError {
    static CODE = 'NOT_FOUND_ERROR';
    static HTTP_STATUS_CODE = 404;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
