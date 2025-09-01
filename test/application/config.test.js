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
    let subject;
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
        subject = new Config(testValues, testSecrets, '/path/to/app');
    });

    it('should extend EventEmitter', () => {
        assertFunction(subject.on);
    });

    it('should have the correct name property', () => {
        assertEqual('Test App', subject.name);
    });

    it('should have the correct processName property', () => {
        assertEqual('test-app', subject.processName);
    });

    it('should have the correct applicationDirectory property', () => {
        assertEqual('/path/to/app', subject.applicationDirectory);
    });
});

describe('Config#constructor with default values', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config({}, {});
    });

    it('should use default name when not provided', () => {
        assertEqual('Kixx Application', subject.name);
    });

    it('should use default processName when not provided', () => {
        assertEqual('kixxapp', subject.processName);
    });

    it('should have undefined applicationDirectory when not provided', () => {
        assertUndefined(subject.applicationDirectory);
    });
});

describe('Config#constructor with null/undefined values', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config(null, undefined, null);
    });

    it('should handle null values gracefully by using default values', () => {
        assertEqual('Kixx Application', subject.name);
        assertEqual('kixxapp', subject.processName);
    });

    it('should handle null applicationDirectory', () => {
        assertEqual(null, subject.applicationDirectory);
    });
});

describe('Config#applicationDirectory getter', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config({}, {}, '/custom/app/path');
    });

    it('should return the application directory path', () => {
        assertEqual('/custom/app/path', subject.applicationDirectory);
    });

    it('should return the same value on multiple calls', () => {
        const firstCall = subject.applicationDirectory;
        const secondCall = subject.applicationDirectory;
        assertEqual(firstCall, secondCall);
    });
});

describe('Config#applicationDirectory with different path types', ({ it }) => {
    it('should handle absolute paths', () => {
        const subject = new Config({}, {}, '/absolute/path/to/app');
        assertEqual('/absolute/path/to/app', subject.applicationDirectory);
    });

    it('should handle relative paths', () => {
        const subject = new Config({}, {}, './relative/path');
        assertEqual('./relative/path', subject.applicationDirectory);
    });

    it('should handle Windows-style paths', () => {
        const subject = new Config({}, {}, 'C:\\Windows\\Path\\To\\App');
        assertEqual('C:\\Windows\\Path\\To\\App', subject.applicationDirectory);
    });

    it('should handle empty string', () => {
        const subject = new Config({}, {}, '');
        assertEqual('', subject.applicationDirectory);
    });

    it('should handle undefined', () => {
        const subject = new Config({}, {}, undefined);
        assertUndefined(subject.applicationDirectory);
    });
});

describe('Config#getNamespace() when namespace exists', ({ before, it }) => {
    let subject;
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
        subject = new Config(testValues, {});
    });

    it('should return the correct namespace data', () => {
        const dbConfig = subject.getNamespace('database');
        assertEqual('localhost', dbConfig.host);
        assertEqual(5432, dbConfig.port);
        assertEqual(true, dbConfig.options.ssl);
        assertEqual(5000, dbConfig.options.timeout);
    });

    it('should return a deep clone, not a reference', () => {
        const dbConfig = subject.getNamespace('database');
        dbConfig.host = 'modified';
        dbConfig.options.ssl = false;

        const dbConfig2 = subject.getNamespace('database');
        assertEqual('localhost', dbConfig2.host);
        assertEqual(true, dbConfig2.options.ssl);
    });

    it('should return different namespace data', () => {
        const redisConfig = subject.getNamespace('redis');
        assertEqual('127.0.0.1', redisConfig.host);
        assertEqual(6379, redisConfig.port);
    });
});

describe('Config#getNamespace() when namespace does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config({}, {});
    });

    it('should return a new empty object for non-existent namespace', () => {
        const result = subject.getNamespace('nonexistent');
        assertEqual(0, Object.keys(result).length);

        result.foo = 'bar';

        const result2 = subject.getNamespace('nonexistent');
        assertNotEqual(result, result2);
        assertUndefined(result2.foo);
    });

    it('should throw an AssertionError for undefined namespace', () => {
        let error;
        try {
            subject.getNamespace();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getNamespace() requires a non empty string for the namespace key (Expected undefined to be a non-empty String)', error.message);
    });

    it('should throw an AssertionError for null namespace', () => {
        let error;
        try {
            subject.getNamespace(null);
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
    let subject;

    before(() => {
        subject = new Config({}, {});
    });

    it('should throw an AssertionError', () => {
        let error;
        try {
            subject.getNamespace('environments');
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
    let subject;
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
        subject = new Config({}, testSecrets);
    });

    it('should return the correct secrets data', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('secret123', dbSecrets.password);
        assertEqual('abc123', dbSecrets.apiKey);
        assertEqual('admin', dbSecrets.credentials.username);
        assertEqual('xyz789', dbSecrets.credentials.token);
    });

    it('should return a deep clone, not a reference', () => {
        const dbSecrets = subject.getSecrets('database');
        dbSecrets.password = 'modified';
        dbSecrets.credentials.username = 'modified';

        const dbSecrets2 = subject.getSecrets('database');
        assertEqual('secret123', dbSecrets2.password);
        assertEqual('admin', dbSecrets2.credentials.username);
    });

    it('should return different secrets data', () => {
        const externalSecrets = subject.getSecrets('external');
        assertEqual('external-key', externalSecrets.apiKey);
    });
});

describe('Config#getSecrets() when namespace does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config({}, {});
    });

    it('should return a new empty object for non-existent namespace', () => {
        const result = subject.getSecrets('nonexistent');
        assertEqual(0, Object.keys(result).length);

        result.foo = 'bar';

        const result2 = subject.getNamespace('nonexistent');
        assertNotEqual(result, result2);
        assertUndefined(result2.foo);
    });

    it('should throw an AssertionError for undefined namespace', () => {
        let error;
        try {
            subject.getSecrets();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getSecrets() requires a non empty string for the namespace key (Expected undefined to be a non-empty String)', error.message);
    });

    it('should throw an AssertionError for null namespace', () => {
        let error;
        try {
            subject.getSecrets(null);
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
        assertEqual('getSecrets() requires a non empty string for the namespace key (Expected null to be a non-empty String)', error.message);
    });
});

describe('Config#getNamespace() with "environments" as namespace key', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config({}, {});
    });

    it('should throw an AssertionError', () => {
        let error;
        try {
            subject.getSecrets('environments');
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
    let subject;
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
        subject = new Config({}, {});
        subject.on('update:config', eventHandler);
        subject.updateConfig('production', rootConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('should merge environment config with root config', () => {
        assertEqual('Production App', subject.name);
        assertEqual('prod-db.example.com', subject.getNamespace('database').host);
        assertEqual(5432, subject.getNamespace('database').port);
        assertEqual(true, subject.getNamespace('database').options.ssl);
        assertEqual(10000, subject.getNamespace('database').options.timeout);
    });

    it('should emit the "update:config" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateConfig() with missing environment', ({ before, after, it }) => {
    let subject;

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
        subject = new Config({}, {});
        subject.on('update:config', eventHandler);
        subject.updateConfig('development', rootConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('should use root config when environment does not exist', () => {
        assertEqual('Root App', subject.name);
        assertEqual('localhost', subject.getNamespace('database').host);
        assertEqual(5432, subject.getNamespace('database').port);
    });

    it('should emit the "update:config" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateConfig() with no environments property', ({ before, after, it }) => {
    let subject;

    const eventHandler = sinon.spy();

    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
    };

    before(() => {
        subject = new Config({}, {});
        subject.on('update:config', eventHandler);
        subject.updateConfig('production', rootConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('should use root config when no environments property exists', () => {
        assertEqual('Root App', subject.name);
        assertEqual('localhost', subject.getNamespace('database').host);
        assertEqual(5432, subject.getNamespace('database').port);
    });

    it('should emit the "update:config" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateSecrets() with environment override', ({ before, after, it }) => {
    let subject;

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
        subject = new Config({}, {});
        subject.on('update:secrets', eventHandler);
        subject.updateSecrets('production', rootSecrets);
    });

    after(() => {
        sinon.restore();
    });

    it('should merge environment secrets with root secrets', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('prod-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
        assertEqual('prod-user', dbSecrets.credentials.username);
        assertEqual('root-token', dbSecrets.credentials.token);
    });

    it('should emit the "update:secrets" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateSecrets() with missing environment', ({ before, after, it }) => {
    let subject;

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
        subject = new Config({}, {});
        subject.on('update:secrets', eventHandler);
        subject.updateSecrets('development', rootSecrets);
    });

    after(() => {
        sinon.restore();
    });

    it('should use root secrets when environment does not exist', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('root-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
    });

    it('should emit the "update:secrets" event', () => {
        assertEqual(1, eventHandler.callCount);
    });
});

describe('Config#updateSecrets() with no environments property', ({ before, after, it }) => {
    let subject;

    const eventHandler = sinon.spy();

    const rootSecrets = {
        database: {
            password: 'root-password',
            apiKey: 'root-key',
        },
    };

    before(() => {
        subject = new Config({}, {});
        subject.on('update:secrets', eventHandler);
        subject.updateSecrets('production', rootSecrets);
    });

    after(() => {
        sinon.restore();
    });

    it('should use root secrets when no environments property exists', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('root-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
    });

    it('should emit the "update:secrets" event', () => {
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

    it('should create Config instance with merged configs and secrets', () => {
        const config = Config.create('production', rootConfig, rootSecrets, '/prod/app/path');

        assertEqual('Production App', config.name);
        assertEqual('prod-db.example.com', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('prod-password', config.getSecrets('database').password);
        assertEqual('/prod/app/path', config.applicationDirectory);
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

    it('should use root config and secrets when environment does not exist', () => {
        const config = Config.create('development', rootConfig, rootSecrets, '/dev/app/path');

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
        assertEqual('/dev/app/path', config.applicationDirectory);
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

    it('should use root config and secrets when no environments property exists', () => {
        const config = Config.create('production', rootConfig, rootSecrets, '/default/app/path');

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
        assertEqual('/default/app/path', config.applicationDirectory);
    });
});

describe('Config.create() with null/undefined applicationDirectory', ({ it }) => {
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

    it('should handle null applicationDirectory', () => {
        const config = Config.create('production', rootConfig, rootSecrets, null);

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
        assertEqual(null, config.applicationDirectory);
    });

    it('should handle undefined applicationDirectory', () => {
        const config = Config.create('production', rootConfig, rootSecrets, undefined);

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
        assertUndefined(config.applicationDirectory);
    });
});
