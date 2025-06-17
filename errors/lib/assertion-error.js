import WrappedError from './wrapped-error.js';


export default class AssertionError extends WrappedError {
    static CODE = 'ASSERTION_ERROR';
}
