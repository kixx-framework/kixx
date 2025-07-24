# Running Background Jobs

## Schedule a Recurring Job
The best way to implement a recurring background job in your custom plugin is by creating a class that:

- Encapsulates the "kixx.JobQueue" service, named child logger, and custom application service.
- Has a method to clear the job queue of any abandoned zombie jobs since the app was last running.
- Has a method to schedule the next job.
- Has a `runJob()` method which does not take any arguments and can be registered on the kixx.JobQueue service as a job handler.
- Has an `initialize()` method which:
    1. Registers the job handler on the job queue.
    2. Clears the job queue of abandoned zombie jobs.
    3. Schedules the next job.

In `plugins/app/jobs/my-recurring-job.js`:

```javascript
export default class MyRecurringJob {
    static METHOD_NAME = 'do_some_work';

    constructor({ logger, jobQueue, service }) {
        this.logger = logger;
        this.jobQueue = jobQueue;
        this.service = service;
    }

    async initialize() {
        jobQueue.registerJobHandler(MyRecurringJob.METHOD_NAME, this.runJob.bind(this));

        await this.clearJobQueue();
        await this.scheduleJob();
    }

    async runJob() {
        this.logger.info('start next job run');

        try {
            await this.service.doSomeWork();
        } catch (error) {
            this.logger.error('job run error', null, error);
        }

        // Schedule the next job:
        await this.scheduleJob();
    }

    async scheduleJob() {
        await this.jobQueue.scheduleJob({
            methodName: MyRecurringJob.METHOD_NAME,
            waitTime: this.getJobIntervalTime(),
        });
    }

    async clearJobQueue() {
        await jobQueue.removeJobsByMethodName(MyRecurringJob.METHOD_NAME);
    }

    getJobIntervalTime() {
        const min = 1000 * 60 * 5;
        const max = 1000 * 60 * 20;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}
```

Then register and initialize your job in your plugin file.

In `plugins/app/plugin.js`:

```javascript
import MyService from './services/my-service.js';
import MyRecurringJob from './jobs/my-recurring-job.js';


export function register(context) {
    context.registerService('MyService', new MyService({
        logger: context.logger.createChild('MyService'),
    }));
}

export async function initialize(context) {
    const service = context.getService('MyService');
    const jobQueue = context.getService('kixx.JobQueue');

    const job = new MyRecurringJob({
        logger: context.logger.createChild('MyRecurringJob'),
        jobQueue,
        service,
    });

    await job.initialize();
}
```
