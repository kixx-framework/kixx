import { assertions } from '../../../kixx/mod.js';

const { assert, isPlainObject, isValidDate } = assertions;

/**
 * Model class representing a weather forecast discussion from NOAA.
 *
 * This class provides methods to construct an instance from either a NOAA API response
 * or a stored document, and to serialize the instance for storage or transmission.
 *
 * Note: The 'url' property always mirrors the value of '@id'.
 */
export default class WeatherForecastDiscussion {

    /**
     * Creates a new WeatherForecastDiscussion instance.
     *
     * @param {object} data - The discussion data.
     * @param {string} data['@id'] - The URL identifier (also used for 'url').
     * @param {string} data.id - The UUID identifier.
     * @param {string} data.url - The URL identifier (should match '@id').
     * @param {string} data.wmoCollectiveId - The WMO collective identifier.
     * @param {string} data.issuingOffice - The issuing office code.
     * @param {Date|string} data.issuanceTime - The time when the discussion was issued (Date or ISO string).
     * @param {string} data.productCode - The product code.
     * @param {string} data.productName - The product name.
     * @param {string} [data.productText] - The detailed forecast discussion text.
     * @param {Date|string} [data._storedAt] - The storage timestamp (optional).
     * @param {string} [data._rev] - The revision identifier (optional).
     */
    constructor(data) {
        this['@id'] = data['@id'];
        this.id = data.id;
        this.url = data.url;
        this.wmoCollectiveId = data.wmoCollectiveId;
        this.issuingOffice = data.issuingOffice;
        this.issuanceTime = data.issuanceTime;
        this.productCode = data.productCode;
        this.productName = data.productName;
        this.productText = data.productText;
        this._storedAt = data._storedAt ? new Date(data._storedAt) : null;
        this._rev = data._rev;
    }

    /**
     * Returns the storage timestamp of the discussion.
     *
     * @returns {Date|null} The date when the discussion was stored, or null if not set.
     */
    get storedAt() {
        return this._storedAt;
    }

    /**
     * Updates this WeatherForecastDiscussion instance with detailed content from API response.
     *
     * Currently extracts and sets the productText from the API response body.
     * This method modifies the current instance rather than creating a new object.
     *
     * @param {object} apiResponseBody - The detailed API response data to merge.
     * @returns {WeatherForecastDiscussion} Returns this instance for method chaining.
     * @throws {AssertionError} If apiResponseBody is not a plain object.
     */
    mergeWithApiResponse(apiResponseBody) {
        this.productText = apiResponseBody.productText;
        return this;
    }

    formatAsHTML() {
        const lines = this.productText.split('\n\n');

        const paragraphs = lines
            .map((line) => {
                return line.trim().replace(/\n/g, ' ');
            })
            .join('</p><p>');

        return `<p>${ paragraphs }</p>`;
    }

    /**
     * Returns a JSON-serializable representation of the discussion.
     *
     * @returns {object} A plain object containing the discussion data, with issuanceTime as an ISO string.
     */
    toJSON() {
        return {
            '@id': this['@id'],
            id: this.id,
            url: this.url,
            wmoCollectiveId: this.wmoCollectiveId,
            issuingOffice: this.issuingOffice,
            issuanceTime: isValidDate(this.issuanceTime) ? this.issuanceTime.toISOString() : null,
            productCode: this.productCode,
            productName: this.productName,
            productText: this.productText,
        };
    }

    /**
     * Returns a plain object suitable for storage in the datastore.
     *
     * @returns {object} A JSON object containing the discussion data with storage metadata.
     */
    toDocument() {
        return {
            '@id': this['@id'],
            id: this.id,
            url: this.url,
            wmoCollectiveId: this.wmoCollectiveId,
            issuingOffice: this.issuingOffice,
            issuanceTime: isValidDate(this.issuanceTime) ? this.issuanceTime.toISOString() : null,
            productCode: this.productCode,
            productName: this.productName,
            productText: this.productText,
            _storedAt: this._storedAt ? this._storedAt.toISOString() : new Date().toISOString(),
            _rev: this._rev,
        };
    }

    /**
     * Creates a WeatherForecastDiscussion instance from a NOAA API response item.
     *
     * Handles conversion of issuanceTime from string to Date.
     *
     * @param {object} item - The API response item (raw NOAA @graph object).
     * @returns {WeatherForecastDiscussion} The constructed discussion instance.
     * @throws {AssertionError} If item is not a plain object.
     */
    static fromApiResponse(item) {
        assert(isPlainObject(item), 'item');

        return new WeatherForecastDiscussion({
            '@id': item['@id'],
            id: item.id,
            url: item['@id'], // url always mirrors @id
            wmoCollectiveId: item.wmoCollectiveId,
            issuingOffice: item.issuingOffice,
            issuanceTime: item.issuanceTime ? new Date(item.issuanceTime) : null,
            productCode: item.productCode,
            productName: item.productName,
            productText: item.productText || null,
        });
    }

    /**
     * Creates a WeatherForecastDiscussion instance from a stored document item.
     *
     * Handles conversion of issuanceTime from ISO string to Date.
     *
     * @param {object} item - The stored document item (from storage).
     * @returns {WeatherForecastDiscussion} The reconstructed discussion instance.
     * @throws {AssertionError} If item is not a plain object.
     */
    static fromDocument(item) {
        assert(isPlainObject(item), 'item');

        return new WeatherForecastDiscussion({
            '@id': item['@id'],
            id: item.id,
            url: item.url, // url always mirrors @id
            wmoCollectiveId: item.wmoCollectiveId,
            issuingOffice: item.issuingOffice,
            issuanceTime: item.issuanceTime ? new Date(item.issuanceTime) : null,
            productCode: item.productCode,
            productName: item.productName,
            productText: item.productText || null,
            _storedAt: item._storedAt ? new Date(item._storedAt) : null,
            _rev: item._rev,
        });
    }
}
