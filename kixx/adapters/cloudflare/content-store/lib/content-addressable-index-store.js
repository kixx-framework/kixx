import { DurableObject } from 'cloudflare:workers';
import ContentAddressableIndexStoreCore from './content-addressable-index-store-core.js';


/**
 * SQLite-backed Durable Object that persists content-addressable index
 * closures, the build pointers that select them, and publishing history.
 *
 * All behavior lives in ContentAddressableIndexStoreCore; this class only
 * binds it to the runtime. Its public methods are the RPC surface the Worker
 * calls.
 * @extends DurableObject
 */
export default class ContentAddressableIndexStore extends DurableObject {

    #core;

    /**
     * @param {DurableObjectState} ctx - Durable Object state, provided by the runtime.
     * @param {Object} env - Worker environment bindings, provided by the runtime.
     */
    constructor(ctx, env) {
        super(ctx, env);
        this.#core = new ContentAddressableIndexStoreCore({ ctx, env });
    }

    migrate() {
        return this.#core.migrate();
    }

    getBuild(buildId) {
        return this.#core.getBuild(buildId);
    }

    getIndex(rootHash) {
        return this.#core.getIndex(rootHash);
    }

    getBuildPointer(buildId) {
        return this.#core.getBuildPointer(buildId);
    }

    listBuilds() {
        return this.#core.listBuilds();
    }

    saveIndex(rootHash, index) {
        return this.#core.saveIndex(rootHash, index);
    }

    registerFile(hash, size) {
        return this.#core.registerFile(hash, size);
    }

    statFiles(hashes) {
        return this.#core.statFiles(hashes);
    }

    assignBuild(buildId, assignment) {
        return this.#core.assignBuild(buildId, assignment);
    }

    recordRelease(release) {
        return this.#core.recordRelease(release);
    }

    getRelease(releaseId) {
        return this.#core.getRelease(releaseId);
    }

    listReleases(page) {
        return this.#core.listReleases(page);
    }

    listActivations(page) {
        return this.#core.listActivations(page);
    }
}
