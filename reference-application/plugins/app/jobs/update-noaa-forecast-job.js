import { assertions } from '../../../kixx/mod.js';

const { isNumberNotNaN } = assertions;

/**
 * Background job for updating NOAA Area Forecast Discussion (AFD) data.
 *
 * This job is designed to be registered with the Kixx JobQueue system as a recurring background task.
 * It fetches the latest AFD product list for the specified office from the NOAA API.
 *
 * Usage:
 *   - Instantiate with required dependencies: logger, jobQueue, and noaaForecastService.
 *   - Call `initialize()` once at application startup to register the job handler, clear any abandoned jobs,
 *     and schedule the first run.
 *   - The job will continue to reschedule itself after each run.
 *
 * Dependencies:
 *   - logger: Logger instance for structured logging.
 *   - jobQueue: Kixx JobQueue service for scheduling and running jobs.
 *   - noaaForecastService: Service responsible for fetching NOAA forecast data.
 *
 * Job Handler:
 *   - The static METHOD_NAME property is used as the job handler name in the job queue.
 *   - The `runJob()` method is registered as the handler and is responsible for fetching the forecast
 *     and scheduling the next run.
 */
export default class UpdateNoaaForecastJob {
    static METHOD_NAME = 'update_noaa_forecast';

    /**
     * Constructs an UpdateNoaaForecastJob instance.
     *
     * @param {object} deps - Dependency injection object.
     * @param {object} deps.logger - Logger instance for structured logging.
     * @param {object} deps.jobQueue - Kixx JobQueue service for scheduling jobs.
     * @param {object} deps.noaaForecastService - Instance of NoaaForecastService for fetching NOAA data.
     * @param {string} deps.locationCode - NOAA office location code (e.g., "btv").
     */
    constructor({ logger, jobQueue, noaaForecastService, locationCode }) {
        this.logger = logger;
        this.jobQueue = jobQueue;
        this.noaaForecastService = noaaForecastService;
        this.locationCode = locationCode;
    }

    /**
     * Initializes the UpdateNoaaForecastJob by:
     * 1. Registering the job handler on the job queue.
     * 2. Clearing any abandoned jobs from the queue.
     * 3. Scheduling the next job run.
     *
     * This method should be called once during application startup to ensure
     * the job is registered and scheduled to run at the desired interval.
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        this.logger.info(`initializing ${ UpdateNoaaForecastJob.METHOD_NAME } job`);
        this.jobQueue.registerJobHandler(UpdateNoaaForecastJob.METHOD_NAME, this.runJob.bind(this));
        await this.clearJobQueue();
        await this.scheduleJob(5 * 1000);
    }

    /**
     * Executes the NOAA forecast update job.
     *
     * This method is registered as the job handler for the UpdateNoaaForecastJob.
     * It attempts to fetch the latest forecast using the NoaaForecastService.
     * Any errors encountered during the fetch are logged.
     * After execution, the next job run is scheduled.
     *
     * @returns {Promise<void>}
     */
    async runJob() {
        this.logger.info(`running ${ UpdateNoaaForecastJob.METHOD_NAME } job`);
        try {
            await this.noaaForecastService.updateForecastListing(this.locationCode);
        } catch (err) {
            this.logger.error(`error in ${ UpdateNoaaForecastJob.METHOD_NAME } job`, null, err);
        }
        await this.scheduleJob();
    }

    /**
     * Schedules the next NOAA forecast update job to run after a 15-minute interval.
     * This method enqueues a job with the method name defined by UpdateNoaaForecastJob.METHOD_NAME.
     *
     * @returns {Promise<void>}
     */
    async scheduleJob(waitTime) {
        // Use a 5 min default interval
        waitTime = isNumberNotNaN(waitTime) ? waitTime : 1000 * 60 * 5;

        await this.jobQueue.scheduleJob({
            methodName: UpdateNoaaForecastJob.METHOD_NAME,
            waitTime,
        });
    }

    /**
     * Removes all pending jobs for this job's method name from the job queue.
     * This helps prevent duplicate or abandoned jobs from running after restarts.
     *
     * @returns {Promise<void>}
     */
    async clearJobQueue() {
        await this.jobQueue.removeJobsByMethodName(UpdateNoaaForecastJob.METHOD_NAME);
    }
}
