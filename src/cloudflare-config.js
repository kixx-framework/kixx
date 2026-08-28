export default {
    name: 'kixx-test-app',

    environments: {
        production: {
            WORKER: {
                name: 'kixx-test-app',
                logpush: false,
                observability: {
                    enabled: true,
                    head_sampling_rate: 1,
                    logs: {
                        enabled: true,
                        invocation_logs: true,
                        persist: true,
                        head_sampling_rate: 1,
                    },
                },
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
                    // files: {
                    //     bucketName: 'kixx-app-production-files',
                    //     bindingName: 'OBJECT_STORE_FILES',
                    // },
                },
            },
            CONTENT_STORE: {
                blobReadCacheTtlSeconds: 60 * 60 * 36,
                indexCacheTtlSeconds: 10,
                kvBindingName: 'CA_STORE_KV_STORE',
                kvNamespaceId: 'a-kv-namespace-uuid',
                durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
            },
        },
    },
};
