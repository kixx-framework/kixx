import process from 'node:process';
import { assertions } from '../kixx/mod.js';

const { assertNonEmptyString } = assertions;


export async function run(context) {
    const noaaForecastService = context.getService('NoaaForecastService');
    const { locationCode } = context.config.getSecrets('NOAA_FORCAST_SERVICE');

    assertNonEmptyString(locationCode, 'NOAA_FORCAST_SERVICE.locationCode is required from .secrets.json');

    try {
        const res = await noaaForecastService.updateForecastListing(locationCode);

        // eslint-disable-next-line no-console
        console.log(`✅ Forecast listing updated successfully:`, res);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('❌ Error updating forecast listing:', error);
        process.exit(1);
    }
}
