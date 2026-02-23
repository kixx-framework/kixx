import { WrappedError } from '../errors.js';
import { assertNonEmptyString, assertDefined } from '../assertions.js';

import VirtualHostSpec from './virtual-host-spec.js';


/**
 * Loads virtual host configurations from a JavaScript module file, validates them,
 * and returns an array of VirtualHostSpec instances ready for use by the HTTP router.
 */
export default class JSModuleHttpRoutesStore {

    #virtualHostsFilepath = null;
    #fileSystem = null;
    #logger = null;

    /**
     * @param {Object} options
     * @param {string} options.virtualHostsFilepath - Absolute path to the JS module file exporting virtual host configurations
     * @param {Object} options.fileSystem - File system abstraction providing importAbsoluteFilepath()
     * @param {Object} options.logger - Logger instance for reporting configuration errors
     */
    constructor({ virtualHostsFilepath, fileSystem, logger }) {
        assertNonEmptyString(virtualHostsFilepath, 'virtualHostsFilepath is required');
        assertDefined(fileSystem, 'fileSystem is required');

        this.#virtualHostsFilepath = virtualHostsFilepath;
        this.#fileSystem = fileSystem;
        this.#logger = logger;
    }

    /**
     * Imports the virtual hosts configuration module, validates each virtual host specification,
     * and returns the validated, flattened route structures.
     * @public
     * @async
     * @returns {Promise<Array<VirtualHostSpec>>} Validated virtual host specs with flattened route trees
     * @throws {WrappedError} When the configuration module cannot be imported
     * @throws {ValidationError} When any virtual host or route specification is invalid
     */
    async loadVirtualHosts() {
        let vhostsConfigs;
        try {
            vhostsConfigs = await this.#fileSystem.importAbsoluteFilepath(this.#virtualHostsFilepath);
        } catch (cause) {
            throw new WrappedError(
                `Error importing virtual hosts configuration from ${ this.#virtualHostsFilepath }`,
                { cause }
            );
        }
        try {
            // validateAndCreate validates and flattens the nested route tree into a single array of leaf routes.
            return vhostsConfigs.map((spec) => VirtualHostSpec.validateAndCreate(spec));
        } catch (cause) {
            if (cause.name === 'ValidationError') {
                this.#logger.error(`Error in routes configuration: ${ cause.message }`);
            }
            throw cause;
        }
    }
}
