import { isBoolean, isUndefined } from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';
import { isDevelopmentEnvironment } from '../config/environment.js';


/**
 * Reads `CONTENT_STORE.workingTree`: whether a development server renders
 * pages and assets from the project's working tree in place of a published
 * Release.
 *
 * Absent, it is on in development and off everywhere else. `false` turns it
 * off. `true` is refused outside development, where there is no working tree
 * to render.
 *
 * Only the Node.js server, which Deno also runs, acts on the answer.
 *
 * @param {Object} config - The app config; reads `environment` and `env.CONTENT_STORE.workingTree`
 * @returns {boolean} True when working-tree content is wanted
 * @throws {OperationalError} When the key isn't a boolean, or is `true` outside development
 */
export function readWorkingTreeSwitch(config) {
    const value = config?.env?.CONTENT_STORE?.workingTree;
    const isDevelopment = isDevelopmentEnvironment(config);

    if (isUndefined(value)) {
        return isDevelopment;
    }

    if (!isBoolean(value)) {
        throw new OperationalError(
            `CONTENT_STORE.workingTree must be true or false (environment "${ config?.environment }").`,
            {},
            readWorkingTreeSwitch,
        );
    }

    if (value && !isDevelopment) {
        throw new OperationalError(
            'CONTENT_STORE.workingTree can be true only in the development environment, '
            + `and this is "${ config?.environment }". Remove the key or set it to false.`,
            {},
            readWorkingTreeSwitch,
        );
    }

    return value;
}
