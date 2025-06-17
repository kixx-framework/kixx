import WrappedError from './wrapped-error.js';


export default class OperationalError extends WrappedError {
    static CODE = 'OPERATIONAL_ERROR';

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
