const ROUTES_CONFIG_FILE_PATTERN = /^virtual-hosts.jsonc?/;


export default class HttpRoutesStore {
    async loadVirtualHosts(middleware, handlers, errorHandlers) {
        const vhostSpecs = await this.#loadVhostSpecs();

        return vhostSpecs.map((vhostSpec) => {
            // Transform specs into runtime objects:
            //  - assign handlers
            //  - flatten route hierarchy
            //  - convert to VirtualHost
            vhostSpec.assignMiddleware(middleware, handlers, errorHandlers);
            vhostSpec.flattenRoutes();
            return vhostSpec.toVirtualHost();
        });
    }

    async #loadVhostSpecs() {
        const filenames = [ 'virtual-hosts.json', 'virtual-hosts.jsonc' ];
        const rootFiles = this.#fileSystem.readDirectory(this.#app_directory);

        const routesConfigFile = rootFiles.find(({ name }) => {
            return filenames.includes(name);
        });

        if (!routesConfigFile) {
            throw new AssertionError(
                `Unable to find expected virtual-hosts.json or virtual-hosts.jsonc file in app directory (${ this.#app_directory })`,
                null,
                this.loadVirtualHosts
            );
        }

        const filepath = path.join(this.#app_directory, routesConfigFile.name);

        let configs;
        try {
            configs = await this.#fileSystem.readJSONFile(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Error reading virtual hosts config file (${ filepath })`,
                { cause },
                this.loadVirtualHosts
            );
        }

        // Since we just read the directory, this condition should only happen when there is
        // a strange race condition after reading the directory.
        if (!configs) {
            throw new AssertionError(
                `Unable to load virtual hosts config file (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        if (!Array.isArray(configs)) {
            throw new AssertionError(
                `vhost configs must be an Array (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        const promises = configs.map(this.#loadRoutesConfigs.bind(this));

        const vhostsConfigs = await Promise.all(promises);

        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    async #loadRoutesConfigs(vhostConfig) {
        // Each URN in vhostConfig.routes may resolve to multiple route configs.
        const promises = vhostConfig.routes.map(this.resolveRoutesConfigUrn.bind(this, vhostConfig));
        const matrix = await Promise.all(promises);

        // Flatten 2D array: [[routes], [routes], ...] -> [route, route, route, ...]
        // Each URN can expand to multiple routes, so we need to flatten for
        // final vhost config.
        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }
}
