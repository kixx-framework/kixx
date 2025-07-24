import http from 'http';
import https from 'https';
import { assertions } from '../../../kixx/mod.js';
import WeatherForecastDiscussionCollection from '../collections/weather-forecast-discussion-collection.js';
import WeatherForecastDiscussion from '../models/weather-forecast-discussion.js';

const { assertNonEmptyString } = assertions;

const NOAA_LATEST_FORECAST_KEY = 'noaa-latest-forecast';


/**
 * Service to fetch NOAA forecast data and log the HTTP status code.
 */
export default class NoaaForecastService {

    constructor() {
        this.logger = null;
        this.datastore = null;
    }

    /**
     * Initialize the service with its dependencies.
     * This method must be called before using the service.
     * @param {object} logger - The logger instance
     * @param {object} datastore - The Kixx datastore service instance
     */
    async initialize(logger, datastore) {
        this.logger = logger;
        this.datastore = datastore;
    }

    async updateForecastListing(locationCode) {
        const url = new URL(`https://api.weather.gov/products/types/afd/locations/${ locationCode }`);
        const { statusCode, body } = await this.makeEndpointRequest(url);

        if (statusCode !== 200) {
            this.logger.error('updateForecastListing: unexpected status code', { url: url.href, statusCode });
            return null;
        }

        const collection = WeatherForecastDiscussionCollection.fromApiResponse(body);

        collection.sortByIssuanceTime();
        const forecast = collection.getFirstForecast();

        if (!forecast) {
            this.logger.warn('updateForecastListing: no forecast found in response', { url: url.href });
            return null;
        }

        return this.storeForecast(forecast);
    }

    /**
     * Retrieves the latest forecast discussion from the datastore, fetches detailed data
     * from the NOAA API using the forecast's URL, and returns a merged data structure.
     *
     * @returns {Promise<object|null>} The merged forecast data with detailed content, or null if no forecast found
     * @throws {Error} If the API request fails or data cannot be merged
     */
    async getLatestForecastWithDetails() {
        // Read latest forecast from datastore
        const storedForecast = await this.getStoredForecast();

        if (!storedForecast) {
            this.logger.warn('getLatestForecastWithDetails: no stored forecast found');
            return null;
        }

        assertNonEmptyString(storedForecast.url, 'storedForecast.url');

        // Fetch detailed data from NOAA API using forecast URL
        const url = new URL(storedForecast.url);
        const { statusCode, body } = await this.makeEndpointRequest(url);

        if (statusCode !== 200) {
            this.logger.error(
                'getLatestForecastWithDetails: API request failed',
                {
                    url: url.href,
                    statusCode,
                    forecastId: storedForecast.id,
                }
            );
            return null;
        }

        // Merge API response with existing WeatherForecastDiscussion model
        return storedForecast.mergeWithApiResponse(body);
    }

    /**
     * Makes an HTTP(S) GET request to the given URL and returns the parsed JSON response.
     *
     * @param {URL} url - The endpoint URL to request.
     * @returns {Promise<{ statusCode: number, body: object }>} Resolves with the HTTP status code and parsed JSON body.
     * @throws {Error} If the request fails or the response cannot be parsed as JSON.
     */
    async makeEndpointRequest(url) {
        this.logger.info('makeEndpointRequest', { url: url.href });

        return new Promise((resolve, reject) => {
            const client = url.protocol === 'https:' ? https : http;

            const options = {
                headers: {
                    Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.8',
                    'User-Agent': 'curl/7.79.1',
                },
            };

            const req = client.get(url, options, (res) => {
                this.logger.info('makeEndpointRequest: response', { url: url.href, statusCode: res.statusCode });

                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(data);
                    } catch (err) {
                        this.logger.error(
                            'error parsing JSON response',
                            { url: url.href, statusCode: res.statusCode },
                            err
                        );
                        return reject(err);
                    }
                    resolve({
                        statusCode: res.statusCode,
                        body: parsed,
                    });
                });
            });

            req.on('error', (error) => {
                this.logger.error('error updating forecast listing', { url: url.href }, error);
                reject(error);
            });
        });
    }

    /**
     * Stores the latest forecast in the Kixx datastore.
     * @param {WeatherForecastDiscussion} forecast - The WeatherForecastDiscussion instance to store
     */
    async storeForecast(forecast) {
        const forecastDocument = forecast.toDocument();
        await this.datastore.setItem(NOAA_LATEST_FORECAST_KEY, forecastDocument, { checkConsistency: false });
        return forecastDocument;
    }

    /**
     * Retrieves the latest stored forecast from the Kixx datastore.
     * @returns {Promise<WeatherForecastDiscussion|null>} The stored forecast instance or null if not found
     */
    async getStoredForecast() {
        const data = await this.datastore.getItem(NOAA_LATEST_FORECAST_KEY);
        return WeatherForecastDiscussion.fromDocument(data);
    }
}
