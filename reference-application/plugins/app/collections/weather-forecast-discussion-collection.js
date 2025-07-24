import { assertions } from '../../../kixx/mod.js';
import WeatherForecastDiscussion from '../models/weather-forecast-discussion.js';

const { assert, assertArray, isPlainObject } = assertions;

/**
 * A collection class for managing WeatherForecastDiscussion items.
 *
 * Provides methods for filtering, sorting, and transforming weather forecast discussions
 * from NOAA's Area Forecast Discussion API. Supports both API response parsing and
 * document storage/retrieval with metadata preservation.
 *
 * @example
 * // Create from API response
 * const collection = WeatherForecastDiscussionCollection.fromApiResponse(apiData);
 *
 * @example
 * // Filter by date range
 * const filtered = collection.filterByDateRange('2025-01-01', '2025-01-31');
 *
 * @example
 * // Get latest discussion
 * const latest = collection.getLatest();
 */
export default class WeatherForecastDiscussionCollection {

    /**
     * Creates a new WeatherForecastDiscussionCollection instance.
     *
     * @param {object} data - The collection data.
     * @param {string} data['@context'] - The JSON-LD context.
     * @param {WeatherForecastDiscussion[]} [data.items=[]] - Array of forecast discussion items.
     * @param {Date|string} [data._storedAt] - The storage timestamp.
     * @param {string} [data._rev] - The revision identifier.
     */
    constructor(data) {
        this['@context'] = data['@context'];
        this.items = data.items || [];
        this._storedAt = data._storedAt;
        this._rev = data._rev;
    }

    /**
     * Returns the number of items in the collection.
     *
     * @returns {number} The number of items in the collection.
     */
    get length() {
        return this.items.length;
    }

    /**
     * Returns the context of the collection.
     *
     * @returns {string} The JSON-LD context.
     */
    get context() {
        return this['@context'];
    }

    /**
     * Returns the storedAt date of the collection.
     *
     * @returns {Date|null} The storedAt date, or null if not set.
     */
    get storedAt() {
        return this._storedAt;
    }

    /**
     * Returns a JSON representation of the collection.
     *
     * @returns {object} A JSON object containing the collection data with '@context', '@graph', and 'storedAt' properties.
     */
    toJSON() {
        return {
            '@context': this.context,
            '@graph': this.items.map((item) => item.toJSON()),
            storedAt: this._storedAt ? this._storedAt.toISOString() : null,
        };
    }

    /**
     * Returns a plain object suitable for storage in the datastore.
     *
     * @returns {object} A JSON object containing the collection data with storage metadata.
     */
    toDocument() {
        return {
            '@context': this.context,
            items: this.items.map((item) => item.toJSON()),
            _storedAt: this._storedAt ? this._storedAt.toISOString() : null,
            _rev: this._rev,
        };
    }

    /**
     * Returns the first WeatherForecastDiscussion in the collection, or null if the collection is empty.
     *
     * @returns {WeatherForecastDiscussion|null} The first discussion or null if the collection is empty.
     */
    getFirstForecast() {
        return this.items.length > 0 ? this.items[0] : null;
    }

    /**
     * Returns a new WeatherForecastDiscussionCollection containing items whose issuanceTime
     * falls within the specified date range (inclusive).
     *
     * @param {Date|string} startDate - The start of the date range (inclusive). Can be a Date object or ISO string.
     * @param {Date|string} endDate - The end of the date range (inclusive). Can be a Date object or ISO string.
     * @returns {WeatherForecastDiscussionCollection} A new collection with filtered items.
     */
    filterByDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        const filtered = this.items.filter((item) => {
            return item.issuanceTime >= start && item.issuanceTime <= end;
        });

        return new WeatherForecastDiscussionCollection({
            '@context': this['@context'],
            items: filtered,
            _storedAt: this._storedAt,
            _rev: this._rev,
        });
    }

    /**
     * Sorts the collection items by issuanceTime in-place.
     *
     * @param {boolean} [ascending=false] - If true, sorts in ascending order (oldest first).
     *   If false, sorts in descending order (newest first). Defaults to false.
     * @returns {WeatherForecastDiscussionCollection} Returns this collection for method chaining.
     */
    sortByIssuanceTime(ascending = false) {
        this.items.sort((a, b) => {
            const timeA = a.issuanceTime.getTime();
            const timeB = b.issuanceTime.getTime();
            return ascending ? timeA - timeB : timeB - timeA;
        });
        return this;
    }

    /**
     * Returns the WeatherForecastDiscussion with the latest issuanceTime, or null if the collection is empty.
     *
     * @returns {WeatherForecastDiscussion|null} The latest discussion or null if the collection is empty.
     */
    getLatest() {
        if (this.items.length === 0) {
            return null;
        }
        return this.items.reduce((latest, current) => {
            return current.issuanceTime > latest.issuanceTime ? current : latest;
        });
    }

    /**
     * Creates a WeatherForecastDiscussionCollection instance from a NOAA API response body.
     *
     * @param {object} responseBody - The parsed JSON response from the NOAA API.
     *   Must contain an '@context' property and an '@graph' array of forecast items.
     * @param {string} responseBody['@context'] - The JSON-LD context object.
     * @param {object[]} responseBody['@graph'] - Array of forecast discussion objects from the API.
     * @returns {WeatherForecastDiscussionCollection}
     * @throws {AssertionError} If responseBody is not a plain object or '@graph' is not an array.
     */
    static fromApiResponse(responseBody) {
        assert(isPlainObject(responseBody), 'responseBody');
        assertArray(responseBody['@graph'], 'responseBody["@graph"]');

        return new WeatherForecastDiscussionCollection({
            '@context': responseBody['@context'],
            items: responseBody['@graph'].map((item) => WeatherForecastDiscussion.fromApiResponse(item)),
        });
    }

    /**
     * Creates a WeatherForecastDiscussionCollection instance from a stored document.
     *
     * @param {object} document - The stored document containing the collection data.
     *   Must have '@context', 'items' (array), '_storedAt', and '_rev' properties.
     * @param {string} document['@context'] - The JSON-LD context.
     * @param {WeatherForecastDiscussion[]} document.items - Array of forecast discussion items.
     * @param {string} document._storedAt - ISO string timestamp of when the document was stored.
     * @param {string} document._rev - The document revision identifier.
     * @returns {WeatherForecastDiscussionCollection}
     * @throws {AssertionError} If document is not a plain object or 'items' is not an array.
     */
    static fromDocument(document) {
        assert(isPlainObject(document), 'document');
        assertArray(document.items, 'document.items');

        return new WeatherForecastDiscussionCollection({
            '@context': document['@context'],
            items: document.items.map((item) => WeatherForecastDiscussion.fromDocument(item)),
            _storedAt: new Date(document._storedAt),
            _rev: document._rev,
        });
    }
}
