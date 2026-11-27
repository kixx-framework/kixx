import { DurableObject } from 'cloudflare:workers';
import IntegrationProbeSqlStoreCore from './integration-probe-sql-store-core.js';


/**
 * Test only. A SQLite-backed Durable Object the integration suite runs its
 * `sql.exec` platform checks in.
 *
 * All behavior lives in IntegrationProbeSqlStoreCore; this class only binds
 * it to the runtime. Its one public method is the RPC surface the Worker
 * calls.
 * @extends DurableObject
 */
export default class IntegrationProbeSqlStore extends DurableObject {

    #core;

    /**
     * @param {DurableObjectState} ctx - Durable Object state, provided by the runtime.
     * @param {Object} env - Worker environment bindings, provided by the runtime.
     */
    constructor(ctx, env) {
        super(ctx, env);
        this.#core = new IntegrationProbeSqlStoreCore({ ctx, env });
    }

    runCheck(name, id) {
        return this.#core.runCheck(name, id);
    }
}
