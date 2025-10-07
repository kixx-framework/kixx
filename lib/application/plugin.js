import path from 'node:path';

export default class Plugin {

    #fileSystem = null;

    // The plugin module filepath can be set by
    // getPluginFilepath() and may be null.
    filepath = null;

    // Functions populated later during loadPlugins() - kept null until then
    register = null;
    initialize = null;

    constructor(fileSystem, directory) {
        this.#fileSystem = fileSystem;

        this.name = path.basename(directory);
        this.directory = directory;

        // Pre-computed paths to avoid repeated path.join operations during runtime
        this.usersDirectory = path.join(directory, 'users');
        this.collectionsDirectory = path.join(directory, 'collections');
        this.formsDirectory = path.join(directory, 'forms');
        this.viewsDirectory = path.join(directory, 'views');
        this.middlewareDirectory = path.join(directory, 'middleware');
        this.requestHandlerDirectory = path.join(directory, 'request-handlers');
        this.errorHandlerDirectory = path.join(directory, 'error-handlers');
    }

    async getModuleFilepath() {
        const entries = await this.#fileSystem.readDirectory(this.directory);

        // Look for plugin.js, plugin.mjs, app.js, or app.mjs as entry point
        const pluginFilePattern = /(plugin|app).(js|mjs)$/;

        const pluginFile = entries.find((entry) => {
            return pluginFilePattern.test(entry.name) && entry.isFile();
        });

        if (pluginFile) {
            return path.join(this.directory, pluginFile.name);
        }

        return null;
    }

    async loadCollections(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to loadCollectionsFromPlugin()');

        const { collectionsDirectory } = plugin;
        const entries = await this.#fileSystem.readDirectory(collectionsDirectory);

        const directories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(collectionsDirectory, entry.name));

        const promises = directories.map(this.loadCollection.bind(this));
        const collections = await Promise.all(promises);

        const map = new Map();

        for (const CollectionConstructor of collections) {
            if (CollectionConstructor) {
                const key = `${ plugin.name }.${ CollectionConstructor.Model.name }`;
                map.set(key, CollectionConstructor);
            }
        }

        return map;
    }

    async loadCollection(directory) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const schemaFile = entries.find((entry) => {
            return entry.isFile() && /.schema.jsonc?$/.test(entry.name);
        });

        const classFile = entries.find((entry) => {
            return entry.isFile() && /.collection.(js|mjs)$/.test(entry.name);
        });

        let schema = {};

        if (schemaFile) {
            const filepath = path.join(dir, schemaFile.name);
            try {
                schema = await this.#fileSystem.readJSONFile(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load Collection model schema from ${ filepath }`,
                    { cause }
                );
            }
        }

        if (classFile) {
            const filepath = path.join(dir, classFile.name);
            let mod;
            try {
                mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load Collection class from ${ filepath }`,
                    { cause }
                );
            }

            const CollectionConstructor = mod.default;
            assertFunction(CollectionConstructor.Model, `Expected Collection Model class member in ${ filepath }`);
            assertNonEmptyString(CollectionConstructor.Model.name, `Expected Collection TYPE class to have a name in ${ filepath }`);

            CollectionConstructor.schema = schema;

            return CollectionConstructor;
        }

        return null;
    }
}
