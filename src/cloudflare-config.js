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
                type: 'd1',
                bindingName: 'DOCUMENT_STORE',
                databaseId: 'a-d1-database-uuid',
            },
            KEY_VALUE_STORE: {
                type: 'kv_namespace',
                bindingName: 'KEY_VALUE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
            OBJECT_STORE: {
                type: 'r2_bucket',
                buckets: {
                    // This is just an example of a configured bucket. Buckets
                    // will need to be configured before they are available.
                    files: {
                        bucketName: 'local-development-files',
                        bindingName: 'OBJECT_STORE_FILES',
                    },
                },
            },
            CONTENT_ADDRESSABLE_STORE: {
                kvBindingName: 'CA_STORE_KV_STORE',
                durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
                blobReadCacheTtlSeconds: 0,
                indexCacheTtlSeconds: 0,
            },
            STATIC_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'STATIC_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
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
                type: 'd1',
                bindingName: 'DOCUMENT_STORE',
                databaseId: 'a-d1-database-uuid',
            },
            KEY_VALUE_STORE: {
                type: 'kv_namespace',
                bindingName: 'KEY_VALUE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
            OBJECT_STORE: {
                type: 'r2_bucket',
                buckets: {
                    // This is just an example of a configured bucket. Buckets
                    // will need to be configured before they are available.
                    files: {
                        bucketName: 'kixx-app-staging-files',
                        bindingName: 'OBJECT_STORE_FILES',
                    },
                },
            },
            CONTENT_ADDRESSABLE_STORE: {
                kvBindingName: 'CA_STORE_KV_STORE',
                durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
                blobReadCacheTtlSeconds: 60 * 60 * 24,
                indexCacheTtlSeconds: 10,
            },
            STATIC_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'STATIC_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
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
                type: 'd1',
                bindingName: 'DOCUMENT_STORE',
                databaseId: 'a-d1-database-uuid',
            },
            KEY_VALUE_STORE: {
                type: 'kv_namespace',
                bindingName: 'KEY_VALUE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
            OBJECT_STORE: {
                type: 'r2_bucket',
                buckets: {
                    // This is just an example of a configured bucket. Buckets
                    // will need to be configured before they are available.
                    files: {
                        bucketName: 'kixx-app-production-files',
                        bindingName: 'OBJECT_STORE_FILES',
                    },
                },
            },
            CONTENT_ADDRESSABLE_STORE: {
                kvBindingName: 'CA_STORE_KV_STORE',
                durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
                blobReadCacheTtlSeconds: 60 * 60 * 36,
                indexCacheTtlSeconds: 10,
            },
            STATIC_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'STATIC_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
        },
    },
};
