export default {
    name: 'kixx-app',

    environments: {
        development: {
            HYPERVIEW: {
                ALLOW_JSON_RESPONSE: true,
                USE_PAGE_CACHE: false,
                USE_TEMPLATE_CACHE: false,
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
            // Development pins both stores to Cloudflare's 30 second cacheTtl
            // floor, matching the disabled page and template caches above: edits
            // should show up on reload, not on a schedule.
            HYPERVIEW_PAGE_DATA_STORE: {
                type: 'kv_namespace',
                bindingName: 'HYPERVIEW_PAGE_DATA_STORE',
                namespaceId: 'a-kv-namespace-uuid',
                cacheTtl: 30,
            },
            HYPERVIEW_TEMPLATE_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'HYPERVIEW_TEMPLATE_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
                cacheTtl: 30,
            },
            STATIC_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'STATIC_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
        },
        staging: {
            HYPERVIEW: {
                ALLOW_JSON_RESPONSE: false,
                USE_PAGE_CACHE: true,
                USE_TEMPLATE_CACHE: true,
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
            // Page data can be published into the live build's namespace, so its
            // cacheTtl is the worst-case publish-to-visible delay. Template keys
            // are immutable within a build and can be cached for a full day.
            HYPERVIEW_PAGE_DATA_STORE: {
                type: 'kv_namespace',
                bindingName: 'HYPERVIEW_PAGE_DATA_STORE',
                namespaceId: 'a-kv-namespace-uuid',
                cacheTtl: 300,
            },
            HYPERVIEW_TEMPLATE_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'HYPERVIEW_TEMPLATE_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
                cacheTtl: 86400,
            },
            STATIC_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'STATIC_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
        },
        production: {
            HYPERVIEW: {
                ALLOW_JSON_RESPONSE: false,
                USE_PAGE_CACHE: true,
                USE_TEMPLATE_CACHE: true,
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
            // Page data can be published into the live build's namespace, so its
            // cacheTtl is the worst-case publish-to-visible delay. Template keys
            // are immutable within a build and can be cached for a full day.
            HYPERVIEW_PAGE_DATA_STORE: {
                type: 'kv_namespace',
                bindingName: 'HYPERVIEW_PAGE_DATA_STORE',
                namespaceId: 'a-kv-namespace-uuid',
                cacheTtl: 300,
            },
            HYPERVIEW_TEMPLATE_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'HYPERVIEW_TEMPLATE_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
                cacheTtl: 86400,
            },
            STATIC_FILE_STORE: {
                type: 'kv_namespace',
                bindingName: 'STATIC_FILE_STORE',
                namespaceId: 'a-kv-namespace-uuid',
            },
        },
    },
};
