export default {
    name: 'kixx-app',

    environments: {
        development: {
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
                path: './data/nodejs_app/document_store.sqlite',
            },
            KEY_VALUE_STORE: {
                path: './data/nodejs_app/key_value_store.sqlite',
            },
            OBJECT_STORE: {
                path: './data/nodejs_app/object_store',
                buckets: {
                    uploads: {},
                },
            },
            CONTENT_STORE: {
                blobReadCacheTtlSeconds: 0,
                indexCacheTtlSeconds: 0,
                pagesDirectory: './pages',
                templatesDirectory: './templates',
            },
            STATIC_FILE_STORE: {
                directory: './public',
            },
        },
        staging: {
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
                blobReadCacheTtlSeconds: 60 * 60 * 24,
                indexCacheTtlSeconds: 10,
                pagesDirectory: './pages',
                templatesDirectory: './templates',
            },
            STATIC_FILE_STORE: {
                directory: './public',
            },
        },
        production: {
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
                blobReadCacheTtlSeconds: 60 * 60 * 36,
                indexCacheTtlSeconds: 10,
                pagesDirectory: './pages',
                templatesDirectory: './templates',
            },
            STATIC_FILE_STORE: {
                directory: './public',
            },
        },
    },
};
