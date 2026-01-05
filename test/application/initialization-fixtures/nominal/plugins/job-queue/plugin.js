class JobQueue {
    async initialize() {
        Object.defineProperty(this, 'initialized', {
            enumerable: true,
            value: true,
        });
        return this;
    }
}

export function register(context) {
    context.registerService('JobQueue', new JobQueue(context));
}

export async function initialize(context) {
    const queue = context.getService('JobQueue');
    const database = context.getService('Database');
    await queue.initialize(database);
}
