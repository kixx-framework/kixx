export default {
    name: 'kixx-test-app',

    environments: {
        production: {
            WORKER: {
                name: 'kixx-test-app',
                // tags: [],
                logpush: false,
                // tail_consumers: [],
                observability: {
                    enabled: true,
                    head_sampling_rate: 1,
                    redact_query_string: false,
                    logs: {
                        enabled: true,
                        invocation_logs: true,
                        persist: true,
                        head_sampling_rate: 1,
                    },
                    traces: {
                        enabled: true,
                        persist: true,
                        head_sampling_rate: 1,
                    },
                },
                subdomain: {
                    enabled: true,
                    previews_enabled: true,
                },
            },
            WORKER_VERSION: {
                compatibility_date: '2026-07-10',
                compatibility_flags: [],
                cache_options: {
                    enabled: true,
                    cross_version_cache: false,
                },
                // limits: {
                //     cpu_ms: 0,
                //     subrequests: 0,
                // },
            },
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
                type: 'd1',
                bindingName: 'DOCUMENT_STORE',
                databaseName: 'kixx-test-document-store',
                databaseId: 'fa4f3114-0e33-4b06-9a41-37eef63961ef',
            },
            KEY_VALUE_STORE: {
                type: 'kv_namespace',
                bindingName: 'KEY_VALUE_STORE',
                namespaceName: 'kixx-test-kv-store',
                namespaceId: 'ee8b296351934246aec30ac6f085d6fe',
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
                kvNamespaceName: 'kixx-test-content-store',
                kvNamespaceId: '5ca4a95c56bb49e8bdc8ed904633aca1',
                durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
                durableObjectClassName: 'ContentAddressableIndexStore',
            },
        },
    },
};
