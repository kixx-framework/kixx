import VirtualHostSpec from './virtual-host-spec.js';


/**
 * Loads virtual host configurations from a JavaScript array, as typically exported
 * from a configuration module.
 *
 * @see {import('../ports/http-routes-store.js').HttpRoutesStore} HttpRoutesStore port
 */
export default class JSModuleHttpRoutesStore {

    /**
     * Array of raw virtual host configuration objects supplied at construction.
     * @type {Array<Object>}
     */
    #vhostsConfigs = null;

    /**
     * @param {Array<Object>} vhostsConfigs - Array of virtual host configuration objects
     * @throws {Error} When vhostsConfigs is not an array
     */
    constructor(vhostsConfigs) {
        if (!Array.isArray(vhostsConfigs)) {
            throw new Error('vhostsConfigs must be an array');
        }
        this.#vhostsConfigs = vhostsConfigs;
    }

    /**
     * Validates each virtual host configuration and returns the resulting VirtualHostSpec instances,
     * with nested route trees flattened into a single array of leaf routes per host.
     * @public
     * @returns {VirtualHostSpec[]} Validated virtual host specifications with flattened routes
     * @throws {ValidationError} When any virtual host configuration fails validation
     */
    loadVirtualHosts() {
        return this.#vhostsConfigs.map((spec) => VirtualHostSpec.validateAndCreate(spec));
    }
}
