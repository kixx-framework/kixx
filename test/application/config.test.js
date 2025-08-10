import { describe } from 'kixx-test';
import { assertEqual, assertFunction } from 'kixx-assert';
import Config from '../../lib/application/config.js';

describe('Config#constructor with valid input', ({ before, it }) => {
    let subject;
    const testValues = {
        name: 'Test App',
        procName: 'test-app',
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
        subject = new Config(testValues, testSecrets);
    });

    it('should extend EventEmitter', () => {
        assertFunction(subject.on);
    });

    it('should have the correct name property', () => {
        assertEqual('Test App', subject.name);
    });

    it('should have the correct procName property', () => {
        assertEqual('test-app', subject.procName);
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

    it('should use default procName when not provided', () => {
        assertEqual('kixx', subject.procName);
    });
});

describe('Config#constructor with null/undefined values', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Config(null, undefined);
    });

    it('should handle null values gracefully by using default values', () => {
        assertEqual('Kixx Application', subject.name);
        assertEqual('kixx', subject.procName);
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

    it('should return an empty object for non-existent namespace', () => {
        const result = subject.getNamespace('nonexistent');
        assertEqual(0, Object.keys(result).length);
    });

    it('should return empty object for undefined namespace', () => {
        const result = subject.getNamespace(undefined);
        assertEqual(0, Object.keys(result).length);
    });

    it('should return empty object for null namespace', () => {
        const result = subject.getNamespace(null);
        assertEqual(0, Object.keys(result).length);
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

    it('should return an empty object for non-existent namespace', () => {
        const result = subject.getSecrets('nonexistent');
        assertEqual(0, Object.keys(result).length);
    });

    it('should return empty object for undefined namespace', () => {
        const result = subject.getSecrets(undefined);
        assertEqual(0, Object.keys(result).length);
    });

    it('should return empty object for null namespace', () => {
        const result = subject.getSecrets(null);
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#updateConfig() with environment override', ({ before, it }) => {
    let subject;
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
        subject.updateConfig('production', rootConfig);
    });

    it('should merge environment config with root config', () => {
        assertEqual('Production App', subject.name);
        assertEqual('prod-db.example.com', subject.getNamespace('database').host);
        assertEqual(5432, subject.getNamespace('database').port);
        assertEqual(true, subject.getNamespace('database').options.ssl);
        assertEqual(10000, subject.getNamespace('database').options.timeout);
    });

    it('should remove environments property from final config', () => {
        const result = subject.getNamespace('environments');
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#updateConfig() with missing environment', ({ before, it }) => {
    let subject;
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
        subject.updateConfig('development', rootConfig);
    });

    it('should use root config when environment does not exist', () => {
        assertEqual('Root App', subject.name);
        assertEqual('localhost', subject.getNamespace('database').host);
        assertEqual(5432, subject.getNamespace('database').port);
    });

    it('should remove environments property from final config', () => {
        const result = subject.getNamespace('environments');
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#updateConfig() with no environments property', ({ before, it }) => {
    let subject;
    const rootConfig = {
        name: 'Root App',
        database: {
            host: 'localhost',
            port: 5432,
        },
    };

    before(() => {
        subject = new Config({}, {});
        subject.updateConfig('production', rootConfig);
    });

    it('should use root config when no environments property exists', () => {
        assertEqual('Root App', subject.name);
        assertEqual('localhost', subject.getNamespace('database').host);
        assertEqual(5432, subject.getNamespace('database').port);
    });
});

describe('Config#updateSecrets() with environment override', ({ before, it }) => {
    let subject;
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
        subject.updateSecrets('production', rootSecrets);
    });

    it('should merge environment secrets with root secrets', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('prod-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
        assertEqual('prod-user', dbSecrets.credentials.username);
        assertEqual('root-token', dbSecrets.credentials.token);
    });

    it('should remove environments property from final secrets', () => {
        const result = subject.getSecrets('environments');
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#updateSecrets() with missing environment', ({ before, it }) => {
    let subject;
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
        subject.updateSecrets('development', rootSecrets);
    });

    it('should use root secrets when environment does not exist', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('root-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
    });

    it('should remove environments property from final secrets', () => {
        const result = subject.getSecrets('environments');
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#updateSecrets() with no environments property', ({ before, it }) => {
    let subject;
    const rootSecrets = {
        database: {
            password: 'root-password',
            apiKey: 'root-key',
        },
    };

    before(() => {
        subject = new Config({}, {});
        subject.updateSecrets('production', rootSecrets);
    });

    it('should use root secrets when no environments property exists', () => {
        const dbSecrets = subject.getSecrets('database');
        assertEqual('root-password', dbSecrets.password);
        assertEqual('root-key', dbSecrets.apiKey);
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
        const config = Config.create('production', rootConfig, rootSecrets);

        assertEqual('Production App', config.name);
        assertEqual('prod-db.example.com', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('prod-password', config.getSecrets('database').password);
    });

    it('should remove environments property from both configs and secrets', () => {
        const config = Config.create('production', rootConfig, rootSecrets);

        const configEnvironments = config.getNamespace('environments');
        const secretsEnvironments = config.getSecrets('environments');

        assertEqual(0, Object.keys(configEnvironments).length);
        assertEqual(0, Object.keys(secretsEnvironments).length);
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

    it('should use root config and secrets when no environments property exists', () => {
        const config = Config.create('production', rootConfig, rootSecrets);

        assertEqual('Root App', config.name);
        assertEqual('localhost', config.getNamespace('database').host);
        assertEqual(5432, config.getNamespace('database').port);
        assertEqual('root-password', config.getSecrets('database').password);
    });
});
