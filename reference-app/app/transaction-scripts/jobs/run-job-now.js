import { jobs } from '../../jobs/mod.js';
import { AssertionError, NotFoundError } from '../../../kixx/errors/mod.js';


/**
 * Enqueues one run of a registered job, due now, on behalf of an operator.
 *
 * The dedupe key `admin-run:<name>` allows only one active manual run per
 * job; a repeat returns the active job with `created: false`. The key frees
 * when that job finishes.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Run inputs.
 * @param {*} args.name - Job name from the submitted form.
 * @param {*} args.payload - Parsed JSON payload; any JSON value.
 * @returns {Promise<{id: string, name: string, key: string|null, status: string, runAt: string, created: boolean}>} The enqueue result.
 * @throws {NotFoundError} With code `JobNotRegistered` when the name is not registered.
 * @throws {PayloadTooLargeError} When the serialized payload exceeds the queue's limit.
 * @throws {AssertionError} When enqueueing fails unexpectedly.
 */
export async function runJobNow(context, { name, payload }) {
    if (!jobs.has(name)) {
        throw new NotFoundError(`Job "${ name }" is not registered`, { code: 'JobNotRegistered' });
    }

    const queue = context.getService('JobQueue');

    let result;
    try {
        result = await queue.enqueue(context, name, payload, { key: `admin-run:${ name }` });
    } catch (cause) {
        if (cause.name === 'PayloadTooLargeError') {
            throw cause;
        }
        throw new AssertionError('Unexpected error while enqueueing job from admin panel', { cause });
    }

    return {
        id: result.id,
        name: result.name,
        key: result.key,
        status: result.status,
        runAt: result.runAt,
        created: result.created,
    };
}
