import WrappedError from './wrapped-error.js';


export default class ConflictError extends WrappedError {
    static CODE = 'CONFLICT_ERROR';
    static HTTP_STATUS_CODE = 409;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
