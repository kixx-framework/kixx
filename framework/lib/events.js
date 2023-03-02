// @ts-check

// These imports are for type checking.
// eslint-disable-next-line no-unused-vars
import { KixxError } from './error-handling.js';


/**
 * @typedef {Object} EventSpecification
 * @prop {String} type
 * @prop {String} message
 * @prop {Object=} info
 * @prop {KixxError=} cause
 */

export class KixxEvent {

    static NAME = 'event';

    /**
     * @type {String}
     */
    name = KixxEvent.NAME;

    /**
     * @type {String}
     */
    type;

    /**
     * @type {String}
     */
    message;

    /**
     * @type {Object}
     */
    info;

    /**
     * @type {KixxError|null}
     */
    cause;

    constructor(spec) {
        spec = spec || {};

        this.type = spec.type;
        this.message = spec.message;
        this.info = spec.info || {};
        this.cause = spec.cause || null;
    }
}

export class ErrorEvent extends KixxEvent {

    static NAME = 'error';

    name = ErrorEvent.NAME;

    /**
     * @type {Boolean}
     */
    fatal = false;

    /**
     * @param  {KixxError} cause
     */
    constructor(cause) {
        super(cause);

        this.type = cause.name;
        this.cause = cause;
        this.fatal = Boolean(cause.fatal);

        Object.freeze(this);
    }
}

export class InfoEvent extends KixxEvent {
    static NAME = 'info';

    name = InfoEvent.NAME;

    /**
     * @param  {EventSpecification} spec
     */
    constructor(spec) {
        super(spec);
        Object.freeze(this);
    }
}

export class DebugEvent extends KixxEvent {
    static NAME = 'debug';

    name = DebugEvent.NAME;

    /**
     * @param  {EventSpecification} spec
     */
    constructor(spec) {
        super(spec);
        Object.freeze(this);
    }
}
