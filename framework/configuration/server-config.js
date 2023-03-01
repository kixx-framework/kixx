// @ts-check

export default class ServerConfig {

    /**
     * @type {Number}
     */
    port;

    /**
     * @type {Boolean}
     */
    encrypted = false;

    constructor(spec) {

        this.port = spec.port;
        this.encrypted = Boolean(spec.encrypted);

        Object.freeze(this);
    }

    /**
     * @param  {{ port:Number, encrypted:Boolean }} config
     * @return {ServerConfig}
     */
    static fromConfigFile(config) {
        // TODO: Data validation for server config files
        return new ServerConfig(config);
    }
}
