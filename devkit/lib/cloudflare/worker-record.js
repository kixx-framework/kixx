/**
 * Interprets a Cloudflare Worker record — the `result` of `getWorker()` — into
 * the two facts the deploy policy needs: whether the Worker has ever been
 * deployed, and which Durable Object classes already have provisioned
 * namespaces.
 *
 * Both are server-side truth. Reading them here is what lets the tool stop
 * inferring Cloudflare's state from a local state file.
 *
 * This module performs no I/O. The orchestrator already fetches the record.
 * @module worker-record
 */

/**
 * @typedef {Object} WorkerRecordFacts
 * @property {boolean} deployed - Whether the Worker has ever served a deployment.
 * @property {string[]} provisionedClasses - Durable Object class names with a provisioned namespace, sorted.
 */

/**
 * @param {Object} worker - The Worker record returned by `CloudflareAPIClient#getWorker()`.
 * @param {string} workerName - The Worker's name, used to strip the namespace name prefix.
 * @returns {WorkerRecordFacts} The deployment state and provisioned class names.
 */
export function readWorkerRecord(worker, workerName) {
    return {
        deployed: isDeployed(worker),
        provisionedClasses: readProvisionedClasses(worker, workerName),
    };
}

/**
 * A Worker that has never been deployed carries a null `deployed_on`. Verified:
 * uploading an undeployed version does not set it, so only a non-empty string
 * proves a deployment happened. Absent, null, and empty all mean never.
 */
function isDeployed(worker) {
    const deployedOn = worker?.deployed_on;

    return typeof deployedOn === 'string' && deployedOn.length > 0;
}

/**
 * Recovers class names from `references.durable_objects[].namespace_name`,
 * observed as `${workerName}_${className}`.
 *
 * That name is derived by Cloudflare rather than declared, so the convention is
 * a parsing hint, not a contract. An entry without the expected prefix yields no
 * class name: a Worker may legitimately reference a namespace owned by another
 * script. Omitting it makes a class look unprovisioned, whose worst outcome is
 * an unnecessary deployment requirement — never a silent 403.
 */
function readProvisionedClasses(worker, workerName) {
    const references = worker?.references?.durable_objects ?? [];
    const prefix = `${ workerName }_`;
    const classNames = [];

    for (const reference of references) {
        const namespaceName = reference?.namespace_name;

        if (typeof namespaceName !== 'string' || !namespaceName.startsWith(prefix)) {
            continue;
        }

        const className = namespaceName.slice(prefix.length);

        if (className.length > 0) {
            classNames.push(className);
        }
    }

    return classNames.sort();
}
