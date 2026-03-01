import WrappedError from './wrapped-error.js';


export default class UnauthorizedError extends WrappedError {
    static CODE = 'UNAUTHORIZED_ERROR';
    static HTTP_STATUS_CODE = 401;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
