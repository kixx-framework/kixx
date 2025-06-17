import WrappedError from './wrapped-error.js';


export default class BadRequestError extends WrappedError {
    static CODE = 'BAD_REQUEST_ERROR';
    static HTTP_STATUS_CODE = 400;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
