import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual,
    assertNotEqual,
    assertUndefined,
    assertFunction
} from 'kixx-assert';
import Config from '../../lib/application/config.js';

describe('Config#constructor with valid input', ({ before, it }) => {
    let config;
    const testValues = {
        name: 'Test App',
        processName: 'test-app',
        database: {
            host: 'localhost',
            port: 5432,
        },
    };
    const testSecrets = {
        database: {
            password: 'secret123',
            apiKey: 'abc123',
        },
    };

    before(() => {
        config = new Config(testValues, testSecrets);
    });

    it('extends EventEmitter', () => {
        assertFunction(config.on);
    });

    it('has the correct name property', () => {
        assertEqual('Test App', config.name);
    });

    it('has the correct processName property', () => {
        assertEqual('test-app', config.processName);
    });
});

describe('Config#constructor with default values', ({ before, it }) => {
    let config;

    before(() => {
        config = new Config({}, {});
    });

    it('uses default name when not provided', () => {
        assertEqual('Kixx Application', config.name);
    });

    it('uses default processName when not provided', () => {
        assertEqual('kixxapp', config.processName);
    });
});

describe('Config#constructor with null/undefined values', ({ before, it }) => {
    let config;

    before(() => {
        config = new Config(null, undefined);
    });

    it('handles null values gracefully by using default values', () => {
        assertEqual('Kixx Application', config.name);
        assertEqual('kixxapp', config.processName);
    });
});

describe('Config#getNamespace() when namespace exists', ({ before, it }) => {
    let config;
    const testValues = {
        database: {
            host: 'localhost',
            port: 5432,
            options: {
                ssl: true,
                timeout: 5000,
            },
        },
        redis: {
            host: '127.0.0.1',
            port: 6379,
        },
    };

    before(() => {
        config = new Config(testValues, {});
    });

    it('returns the correct namespace data', () => {
        const dbConfig = config.getNamespace('database');
        assertEqual('localhost', dbConfig.host);
        assertEqual(5432, dbConfig.port);
        assertEqual(true, dbConfig.options.ssl);
        assertEqual(5000, dbConfig.options.timeout);
    });

    it('returns a deep clone, not a reference', () => {
        const dbConfig = config.getNamespace('database');
        dbConfig.host = 'modified';
        dbConfig.options.ssl = false;

        const dbConfig2 = config.getNamespace('database');
        assertEqual('localhost', dbConfig2.host);
        assertEqual(true, dbConfig2.options.ssl);
    });

    it('returns different namespace data', () => {
        const redisConfig = config.getNamespace('redis');
        assertEqual('127.0.0.1', redisConfig.host);
        assertEqual(6379, redisConfig.port);
    });
});

describe('Config#getNamespace() when namespace does not exist', ({ before, it }) => {
    let config;

    before(() => {
        config = new Config({}, {});
    });

    it('returns a new empty object for non-existent namespace', () => {
        const result = config.getNamespace('nonexistent');
        assertEqual(0, Object.keys(result).length);

        result.foo = 'bar';

        const result2 = config.getNamespace('nonexistent');
        assertNotEqual(result, result2);
        assertUndefined(result2.foo);
    });

    it('throws an AssertionError for undefined namespace', () => {
        let error;
        try {
            config.getNamespace();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getNamespace() requires a non empty string for the namespace key (Expected undefined to be a non-empty String)', error.message);
    });

    it('throws an AssertionError for null namespace', () => {
        let error;
        try {
            config.getNamespace(null);
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getNamespace() requires a non empty string for the namespace key (Expected null to be a non-empty String)', error.message);
    });
});

describe('Config#getNamespace() with "environments" as namespace key', ({ before, it }) => {
    let config;

    before(() => {
        config = new Config({}, {});
    });

    it('throws an AssertionError', () => {
        let error;
        try {
            config.getNamespace('environments');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getNamespace() cannot be called with "environments" as namespace key (Expected String(environments) to NOT equal (!==) String(environments))', error.message);
    });
});

describe('Config#getSecrets() when namespace exists', ({ before, it }) => {
    let config;
    const testSecrets = {
        database: {
            password: 'secret123',
            apiKey: 'abc123',
            credentials: {
                username: 'admin',
                token: 'xyz789',
            },
        },
        external: {
            apiKey: 'external-key',
        },
    };

    before(() => {
        config = new Config({}, testSecrets);
    });

    it('returns the correct secrets data', () => {
        const dbSecrets = config.getSecrets('database');
        assertEqual('secret123', dbSecrets.password);
        assertEqual('abc123', dbSecrets.apiKey);
        assertEqual('admin', dbSecrets.credentials.username);
        assertEqual('xyz789', dbSecrets.credentials.token);
    });

    it('returns a deep clone, not a reference', () => {
        const dbSecrets = config.getSecrets('database');
        dbSecrets.password = 'modified';
        dbSecrets.credentials.username = 'modified';

        const dbSecrets2 = config.getSecrets('database');
        assertEqual('secret123', dbSecrets2.password);
        assertEqual('admin', dbSecrets2.credentials.username);
    });

    it('returns different secrets data', () => {
        const externalSecrets = config.getSecrets('external');
        assertEqual('external-key', externalSecrets.apiKey);
    });
});

describe('Config#getSecrets() when namespace does not exist', ({ before, it }) => {
    let config;

    before(() => {
        config = new Config({}, {});
    });

    it('returns a new empty object for non-existent namespace', () => {
        const result = config.getSecrets('nonexistent');
        assertEqual(0, Object.keys(result).length);

        result.foo = 'bar';

        const result2 = config.getNamespace('nonexistent');
        assertNotEqual(result, result2);
        assertUndefined(result2.foo);
    });

    it('throws an AssertionError for undefined namespace', () => {
        let error;
        try {
            config.getSecrets();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getSecrets() requires a non empty string for the namespace key (Expected undefined to be a non-empty String)', error.message);
    });

    it('throws an AssertionError for null namespace', () => {
        let error;
        try {
            config.getSecrets(null);
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getSecrets() requires a non empty string for the namespace key (Expected null to be a non-empty String)', error.message);
    });
});

describe('Config#getSecrets() with "environments" as namespace key', ({ before, it }) => {
    let config;

    before(() => {
        config = new Config({}, {});
    });

    it('throws an AssertionError', () => {
        let error;
        try {
            config.getSecrets('environments');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getSecrets() cannot be called with "environments" as namespace key (Expected String(environments) to NOT equal (!==) String(environments))', error.message);
    });
});

describe('Config#updateConfig() with environment override', ({ before, after, it }) => {
    let config;
    const eventHandler = sinon.spy();

    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
            options: {
                ssl: false,
                timeout: 3000,
            },
        },
        environments: {
            production: {
                name: 'Production App',
                database: {
                    host: 'prod-db.example.com',
                    options: {
                        ssl: true,
                        timeout: 10000,
                    },
                },
            },
        },
    };

    before(() => {
        config = new Config({}, {});
        config.on('update:config', eventHandler);
        config.updateConfig('production', rootConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('merges environment config with root config', () => {
        assertEqual('Production App', config.name);
        assertEqual('prod-db.example.com', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual(true, config.getNamespace('database').options.ssl);
        assertEqual(10000, config.getNamespace('database').options.timeout);
    });

    it('emits the "update:config" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateConfig() with missing environment', ({ before, after, it }) => {
    let config;

    const eventHandler = sinon.spy();

    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
        environments: {
            production: {
                name: 'Production App',
            },
        },
    };

    before(() => {
        config = new Config({}, {});
        config.on('update:config', eventHandler);
        config.updateConfig('development', rootConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('uses root config when environment does not exist', () => {
        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
    });

    it('emits the "update:config" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateConfig() with no environments property', ({ before, after, it }) => {
    let config;

    const eventHandler = sinon.spy();

    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
    };

    before(() => {
        config = new Config({}, {});
        config.on('update:config', eventHandler);
        config.updateConfig('production', rootConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('uses root config when no environments property exists', () => {
        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
    });

    it('emits the "update:config" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateSecrets() with environment override', ({ before, after, it }) => {
    let config;

    const eventHandler = sinon.spy();

    const rootSecrets = {
        database: {
            password: 'root-password',
            apiKey: 'root-key',
            credentials: {
                username: 'root-user',
                token: 'root-token',
            },
        },
        environments: {
            production: {
                database: {
                    password: 'prod-password',
                    credentials: {
                        username: 'prod-user',
                    },
                },
            },
        },
    };

    before(() => {
        config = new Config({}, {});
        config.on('update:secrets', eventHandler);
        config.updateSecrets('production', rootSecrets);
    });

    after(() => {
        sinon.restore();
    });

    it('merges environment secrets with root secrets', () => {
        const dbSecrets = config.getSecrets('database');
        assertEqual('prod-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
        assertEqual('prod-user', dbSecrets.credentials.username);
        assertEqual('root-token', dbSecrets.credentials.token);
    });

    it('emits the "update:secrets" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateSecrets() with missing environment', ({ before, after, it }) => {
    let config;

    const eventHandler = sinon.spy();

    const rootSecrets = {
        database: {
            password: 'root-password',
            apiKey: 'root-key',
        },
        environments: {
            production: {
                database: {
                    password: 'prod-password',
                },
            },
        },
    };

    before(() => {
        config = new Config({}, {});
        config.on('update:secrets', eventHandler);
        config.updateSecrets('development', rootSecrets);
    });

    after(() => {
        sinon.restore();
    });

    it('uses root secrets when environment does not exist', () => {
        const dbSecrets = config.getSecrets('database');
        assertEqual('root-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
    });

    it('emits the "update:secrets" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateSecrets() with no environments property', ({ before, after, it }) => {
    let config;

    const eventHandler = sinon.spy();

    const rootSecrets = {
        database: {
            password: 'root-password',
            apiKey: 'root-key',
        },
    };

    before(() => {
        config = new Config({}, {});
        config.on('update:secrets', eventHandler);
        config.updateSecrets('production', rootSecrets);
    });

    after(() => {
        sinon.restore();
    });

    it('uses root secrets when no environments property exists', () => {
        const dbSecrets = config.getSecrets('database');
        assertEqual('root-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
    });

    it('emits the "update:secrets" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config.create() with environment override', ({ it }) => {
    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
        environments: {
            production: {
                name: 'Production App',
                database: {
                    host: 'prod-db.example.com',
                },
            },
        },
    };

    const rootSecrets = {
        database: {
            password: 'root-password',
        },
        environments: {
            production: {
                database: {
                    password: 'prod-password',
                },
            },
        },
    };

    it('creates Config instance with merged configs and secrets', () => {
        const config = Config.create('production', rootConfig, rootSecrets);

        assertEqual('Production App', config.name);
        assertEqual('prod-db.example.com', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('prod-password', config.getSecrets('database').password);
    });
});

describe('Config.create() with missing environment', ({ it }) => {
    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
        environments: {
            production: {
                name: 'Production App',
            },
        },
    };

    const rootSecrets = {
        database: {
            password: 'root-password',
        },
        environments: {
            production: {
                database: {
                    password: 'prod-password',
                },
            },
        },
    };

    it('uses root config and secrets when environment does not exist', () => {
        const config = Config.create('development', rootConfig, rootSecrets);

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
    });
});

describe('Config.create() with no environments property', ({ it }) => {
    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
    };

    const rootSecrets = {
        database: {
            password: 'root-password',
        },
    };

    it('uses root config and secrets when no environments property exists', () => {
        const config = Config.create('production', rootConfig, rootSecrets);

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
    });
});
