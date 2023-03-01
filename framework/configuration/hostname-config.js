// @ts-check

import KixxAssert from 'kixx-assert';

const { isNonEmptyString } = KixxAssert.helpers;

export default class HostnameConfig {

    /**
     * @type {String}
     */
    hostname;

    /**
     * @type {Boolean}
     */
    preferEncrypted = false;

    /**
     * @type {String|null}
     */
    certificate = null;

    constructor(spec) {
        this.hostname = spec.hostname;
        this.preferEncrypted = Boolean(spec.preferEncrypted);
        this.certificate = spec.certificate || null;

        Object.freeze(this);
    }

    /**
     * @param  {Boolean} preferEncrypted
     * @param  {{ hostname:String, certificate:String }} config
     * @return {HostnameConfig}
     */
    static fromConfigFile(preferEncrypted, config) {
        // TODO: Data validation for server config files

        const { hostname, certificate } = config;

        return new HostnameConfig({
            hostname,
            preferEncrypted: Boolean(preferEncrypted && isNonEmptyString(certificate)),
            certificate,
        });
    }
}
