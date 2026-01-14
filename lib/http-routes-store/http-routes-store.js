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

        const promises = configs.map((config) => {
            return this.#loadRoutesConfigs(config, filepath);
        });

        const vhostsConfigs = await Promise.all(promises);

        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    async #loadRoutesConfigs(vhostConfig, filepath) {
        if (!Array.isArray(vhostConfig.routes)) {
            throw new AssertionError(
                `vhost routes must be an Array (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        // Each URN in vhostConfig.routes may resolve to multiple route configs.
        const promises = vhostConfig.routes.map((urn) => {
            if (urn.startsWith('app://')) {
                // TODO: Resolve and load the URN
                // const filepath = this.resolveAppUrnToFilepath(urn);
                // routesConfigs = await this.loadJSONFile(filepath);
            } else {
                throw new AssertionError(
                    `Invalid routes URN protocol: ${ urn } (${ filepath })`,
                    null,
                    this.loadVirtualHosts
                );
            }
        });

        const matrix = await Promise.all(promises);

        // Flatten 2D array: [[routes], [routes], ...] -> [route, route, route, ...]
        // Each URN can expand to multiple routes, so we need to flatten for
        // final vhost config.
        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    async #resolveRoutesConfigUrn(vhostConfig, urn) {
        let routesConfigs;

        if (urn.startsWith('app://')) {
            const filepath = this.resolveAppUrnToFilepath(urn);
            routesConfigs = await this.loadJSONFile(filepath);
        } else {
            throw new AssertionError(`Invalid routes config URN: ${ urn } (expected app://)`);
        }

        assertArray(routesConfigs, `routes config must be an array (${ urn })`);

        // Validate each route config and enhance error messages with context.
        return routesConfigs.map((config, index) => {
            try {
                HttpRouteSpec.validateAndCreate(config, vhostConfig.name, index);
            } catch (cause) {
                throw new AssertionError(
                    `Error validating routes config: ${ urn } (${ cause.message })`,
                    { cause }
                );
            }
            return config;
        });
    }
}
