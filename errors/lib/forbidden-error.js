import WrappedError from './wrapped-error.js';


export default class ForbiddenError extends WrappedError {
    static CODE = 'FORBIDDEN_ERROR';
    static HTTP_STATUS_CODE = 403;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
