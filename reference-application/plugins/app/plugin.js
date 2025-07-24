import NoaaForecastService from './services/noaa-forecast-service.js';
import UpdateNoaaForecastJob from './jobs/update-noaa-forecast-job.js';

/**
 * Register services for the app plugin.
 * @param {object} context - The Kixx application context
 */
export function register(context) {
    context.registerService('NoaaForecastService', new NoaaForecastService());
}

/**
 * Initialize jobs for the app plugin.
 * @param {object} context - The Kixx application context
 */
export async function initialize(context) {
    const noaaForecastService = context.getService('NoaaForecastService');
    const jobQueue = context.getService('kixx.JobQueue');
    const datastore = context.getService('kixx.Datastore');
    const forcastServiceSecrets = context.config.getSecrets('NOAA_FORCAST_SERVICE');

    // Initialize the NoaaForecastService with logger and datastore
    await noaaForecastService.initialize(
        context.logger.createChild('NoaaForecastService'),
        datastore
    );

    if (context.runtime.server) {
        // Only initialize the background job queue if the server is running.
        const job = new UpdateNoaaForecastJob({
            logger: context.logger.createChild('UpdateNoaaForecastJob'),
            jobQueue,
            noaaForecastService,
            locationCode: forcastServiceSecrets.locationCode,
        });

        await job.initialize();
    }
}
