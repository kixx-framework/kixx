import { errors } from '../../../kixx/mod.js';

const { NotFoundError } = errors;

/**
 * Creates a request handler for viewing the latest weather forecast.
 *
 * Returns a handler function that retrieves the latest weather forecast with detailed content
 * and presents it either as JSON or HTML depending on the request type.
 *
 * @returns {Function} The request handler function that processes weather forecast requests.
 */
export default function ViewLatestWeatherForecast() {
    /**
     * Request handler for viewing the latest weather forecast.
     *
     * @param {object} context - The Kixx application context.
     * @param {object} request - The HTTP request object.
     * @param {object} response - The HTTP response object.
     * @returns {Promise<object>} The response object.
     * @throws {NotFoundError} When no weather forecast data is available.
     */
    return async function viewLatestWeatherForecast(context, request, response) {
        const noaaForecastService = context.getService('NoaaForecastService');

        const forecast = await noaaForecastService.getLatestForecastWithDetails();

        if (!forecast) {
            throw new NotFoundError('No weather forecast data available');
        }

        const forecastDate = forecast.issuanceTime.toLocaleString('en-US', { timeZone: 'America/New_York' });

        const props = {
            title: `${ forecastDate } - Latest Weather Forecast`,
            description: `The latest weather forecast discussion (${ forecastDate }) from ${ forecast.issuingOffice }`,
            forecast,
            forecastHTML: forecast.formatAsHTML(),
        };

        response.updateProps(props);
        return response;
    };
}
