import { registerJobQueue } from './lib/register-job-queue.js';
// Export the Durable Object class for the Cloudflare runtime binding.
export { default as JobQueueStore } from './lib/job-queue-store.js';


export function register(context) {
    registerJobQueue(context);
}
