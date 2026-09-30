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
                // A job must finish inside one Durable Object alarm invocation.
                // Jobs that need more than the default CPU budget (30 s) must
                // raise cpu_ms (maximum 300000); otherwise split them into chained jobs.
                // limits: {
                //     cpu_ms: 0,
                //     subrequests: 0,
                // },
            },
            LOGGER: {
                level: 'info',
            },
            SEND_EMAIL: {
                // Placeholder only: replace with an address on an onboarded,
                // verified sender domain before enabling production sending.
                from: 'replace-me@example.com',
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
                    files: {
                        bucketName: 'kixx-test-app-production-files',
                        bindingName: 'OBJECT_STORE_FILES',
                    },
                },
            },
            FILES: {
                maxUploadBytes: 52428800,
                bucket: 'files',
            },
            // Background jobs run inside one SQLite-backed Durable Object via alarm().
            // softDeadlineSeconds: stop claiming new jobs after this long in one
            // invocation, then re-arm the alarm for a fresh CPU budget.
            JOB_QUEUE: {
                enabled: true,
                durableObjectBindingName: 'JOB_QUEUE_DURABLE_OBJECT',
                durableObjectClassName: 'JobQueueStore',
                concurrency: 4,
                softDeadlineSeconds: 20,
                retention: {
                    completedMaxAgeDays: 7,
                    failedMaxAgeDays: 30,
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
