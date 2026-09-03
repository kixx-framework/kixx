export default {
    name: 'kixx-app',

    environments: {
        development: {
            LOGGER: {
                level: 'debug',
            },
            HYPERVIEW: {
                useTemplateCache: false,
                usePageCache: false,
                allowJsonResponse: true,
                pageCacheReadTtlSeconds: 0,
                pageCacheExpirationSeconds: 0,
            },
            SECRET_ENCRYPTION: {
                PBKDF2_ITERATIONS: 50000,
            },
            RATE_LIMIT: {
                ADMIN_LOGIN: {
                    maxFailures: 5,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_SIGNUP: {
                    maxFailures: 10,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_INVITE: {
                    maxFailures: 3,
                    windowSeconds: 900,
                    cooldownSeconds: 3600,
                },
            },
            DOCUMENT_STORE: {
                path: '../data/nodejs_app/document_store.sqlite',
            },
            KEY_VALUE_STORE: {
                path: '../data/nodejs_app/key_value_store.sqlite',
            },
            OBJECT_STORE: {
                path: '../data/nodejs_app/object_store',
                buckets: {
                    uploads: {},
                },
            },
            CONTENT_STORE: {
                developerMode: true,
                pagesDirectory: './pages',
                templatesDirectory: './templates',
                staticAssetsDirectory: './static-assets',
                emailsDirectory: './emails',
            },
        },
        staging: {
            LOGGER: {
                level: 'info',
            },
            HYPERVIEW: {
                useTemplateCache: true,
                usePageCache: true,
                allowJsonResponse: true,
                pageCacheReadTtlSeconds: 60 * 5,
                pageCacheExpirationSeconds: 60 * 12,
            },
            SECRET_ENCRYPTION: {
                PBKDF2_ITERATIONS: 50000,
            },
            RATE_LIMIT: {
                ADMIN_LOGIN: {
                    maxFailures: 5,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_SIGNUP: {
                    maxFailures: 10,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_INVITE: {
                    maxFailures: 3,
                    windowSeconds: 900,
                    cooldownSeconds: 3600,
                },
            },
            DOCUMENT_STORE: {
                path: '../data/nodejs_app/document_store.sqlite',
            },
            KEY_VALUE_STORE: {
                path: '../data/nodejs_app/key_value_store.sqlite',
            },
            OBJECT_STORE: {
                path: '../data/nodejs_app/object_store',
                buckets: {
                    uploads: {},
                },
            },
            CONTENT_STORE: {
                rootDirectory: '../data/nodejs_app/content_store',
            },
        },
        local: {
            LOGGER: {
                level: 'info',
            },
            HYPERVIEW: {
                useTemplateCache: true,
                usePageCache: true,
                allowJsonResponse: true,
                pageCacheReadTtlSeconds: 60 * 5,
                pageCacheExpirationSeconds: 60 * 12,
            },
            // Kept at the same value as every other environment so a freshly
            // seeded instance hashes passwords quickly during login.
            SECRET_ENCRYPTION: {
                PBKDF2_ITERATIONS: 50000,
            },
            RATE_LIMIT: {
                ADMIN_LOGIN: {
                    maxFailures: 5,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_SIGNUP: {
                    maxFailures: 10,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_INVITE: {
                    maxFailures: 3,
                    windowSeconds: 900,
                    cooldownSeconds: 3600,
                },
            },
            // Every store path is instance-relative. resolveFilepath resolves
            // these against DATA_DIRECTORY, so each local target instance keeps
            // its own copy of every store instead of sharing the development data.
            DOCUMENT_STORE: {
                path: './document_store.sqlite',
            },
            KEY_VALUE_STORE: {
                path: './key_value_store.sqlite',
            },
            OBJECT_STORE: {
                path: './object_store',
                buckets: {
                    uploads: {},
                },
            },
            CONTENT_STORE: {
                rootDirectory: './content_store',
            },
        },
        production: {
            LOGGER: {
                level: 'info',
            },
            HYPERVIEW: {
                useTemplateCache: true,
                usePageCache: true,
                allowJsonResponse: false,
                pageCacheReadTtlSeconds: 60 * 60,
                pageCacheExpirationSeconds: 60 * 60 * 4,
            },
            SECRET_ENCRYPTION: {
                PBKDF2_ITERATIONS: 50000,
            },
            RATE_LIMIT: {
                ADMIN_LOGIN: {
                    maxFailures: 5,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_SIGNUP: {
                    maxFailures: 10,
                    windowSeconds: 900,
                    cooldownSeconds: 900,
                },
                ADMIN_INVITE: {
                    maxFailures: 3,
                    windowSeconds: 900,
                    cooldownSeconds: 3600,
                },
            },
            DOCUMENT_STORE: {
                path: '../data/nodejs_app/document_store.sqlite',
            },
            KEY_VALUE_STORE: {
                path: '../data/nodejs_app/key_value_store.sqlite',
            },
            OBJECT_STORE: {
                path: '../data/nodejs_app/object_store',
                buckets: {
                    uploads: {},
                },
            },
            CONTENT_STORE: {
                rootDirectory: '../data/nodejs_app/content_store',
            },
        },
    },
};
