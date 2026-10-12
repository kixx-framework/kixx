import { isPlainObject } from '../assertions/mod.js';


/**
 * Logger handed to job handlers. It stamps every entry with the job's id and
 * name and forwards to the shared application logger.
 *
 * This is a wrapper rather than `Logger#createChild()` because a child is
 * registered on its parent for the life of the process (one leaked logger per
 * job), and the application logger is finalized after boot, which makes
 * `createChild()` throw.
 */
export default class JobLogger {

    #logger;
    #fields;

    /**
     * @param {Object} logger - The application logger to forward to.
     * @param {{jobId: string, jobName: string}} fields - Fields added to every entry.
     */
    constructor(logger, fields) {
        this.#logger = logger;
        this.#fields = fields;
    }

    get name() {
        return this.#logger.name;
    }

    get level() {
        return this.#logger.level;
    }

    debug(message, info, error) {
        this.#logger.debug(message, this.#withFields(info), error);
    }

    info(message, info, error) {
        this.#logger.info(message, this.#withFields(info), error);
    }

    warn(message, info, error) {
        this.#logger.warn(message, this.#withFields(info), error);
    }

    error(message, info, error) {
        this.#logger.error(message, this.#withFields(info), error);
    }

    #withFields(info) {
        if (info === undefined) {
            return { ...this.#fields };
        }

        // Non-object info is preserved under its own key instead of being dropped.
        return isPlainObject(info) ? { ...this.#fields, ...info } : { ...this.#fields, info };
    }
}
