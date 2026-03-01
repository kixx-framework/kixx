import WrappedError from './wrapped-error.js';


export default class NotImplementedError extends WrappedError {
    static CODE = 'NOT_IMPLEMENTED_ERROR';
    static HTTP_STATUS_CODE = 501;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
