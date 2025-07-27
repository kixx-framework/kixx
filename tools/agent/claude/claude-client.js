import http from 'node:http';
import https from 'node:https';
import { WrappedError } from 'kixx-server-errors';
import { assertNonEmptyString, assertNumberNotNaN } from 'kixx-assert';
import ClaudeResponse from './claude-response.js';

// See messages API:
// https://docs.anthropic.com/en/api/messages

const BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export const MODELS = {
    claudeOpus4: {
        type: 'model',
        id: 'claude-opus-4-20250514',
        display_name: 'Claude Opus 4',
        created_at: '2025-05-22T00:00:00Z',
    },
    claudeSonnet4: {
        type: 'model',
        id: 'claude-sonnet-4-20250514',
        display_name: 'Claude Sonnet 4',
        created_at: '2025-05-22T00:00:00Z',
    },
    claudeSonnet37: {
        type: 'model',
        id: 'claude-3-7-sonnet-20250219',
        display_name: 'Claude Sonnet 3.7',
        created_at: '2025-02-24T00:00:00Z',
    },
    claudeSonnet35New: {
        type: 'model',
        id: 'claude-3-5-sonnet-20241022',
        display_name: 'Claude Sonnet 3.5 (New)',
        created_at: '2024-10-22T00:00:00Z',
    },
    claudeHaiku35: {
        type: 'model',
        id: 'claude-3-5-haiku-20241022',
        display_name: 'Claude Haiku 3.5',
        created_at: '2024-10-22T00:00:00Z',
    },
    claudeSonnet35Old: {
        type: 'model',
        id: 'claude-3-5-sonnet-20240620',
        display_name: 'Claude Sonnet 3.5 (Old)',
        created_at: '2024-06-20T00:00:00Z',
    },
    claudeHaiku3: {
        type: 'model',
        id: 'claude-3-haiku-20240307',
        display_name: 'Claude Haiku 3',
        created_at: '2024-03-07T00:00:00Z',
    },
};

export default class Claude {

    #anthropicVersion;
    #apiKey;
    #defaultModel;
    #defaultMaxTokens;

    constructor(options) {
        assertNonEmptyString(options.apiKey, 'apiKey');

        if (options.defaultModel) {
            assertNonEmptyString(options.defaultModel, 'defaultModel');
        }
        if (options.defaultMaxTokens) {
            assertNumberNotNaN(options.defaultMaxTokens, 'defaultMaxTokens');
        }

        this.#anthropicVersion = options.anthropicVersion || DEFAULT_ANTHROPIC_VERSION;
        this.#apiKey = options.apiKey;
        this.#defaultModel = options.defaultModel;
        this.#defaultMaxTokens = options.defaultMaxTokens;
    }

    async sendMessage(message) {
        const url = new URL(BASE_URL);
        url.pathname = `${ url.pathname }/messages`;

        message.useDefaults({
            model: this.#defaultModel,
            max_tokens: this.#defaultMaxTokens,
        });

        const result = await this.makeHttpPostRequest(url, message.toJSON());
        const { statusCode, headers, body } = result;
        const requestId = headers['request-id'] || null;

        let response;
        if (statusCode !== 200) {
            try {
                response = JSON.parse(body);
            } catch (cause) {
                const error = new WrappedError('failed to parse error response JSON', { cause, statusCode });
                return { requestId, error, statusCode, body };
            }
            return { requestId, statusCode, error: response, response: null };
        }

        try {
            response = JSON.parse(body);
        } catch (cause) {
            const error = new WrappedError('failed to parse response body JSON', { cause, statusCode });
            return { requestId, error, statusCode, body };
        }

        return {
            requestId,
            statusCode,
            error: null,
            response: new ClaudeResponse(headers, response),
        };
    }

    async listModels() {
        const url = new URL(BASE_URL);
        url.pathname = `${ url.pathname }/models`;

        const result = await this.makeHttpGetRequest(url);
        const { statusCode, headers, body } = result;
        const requestId = headers['request-id'] || null;

        let response;
        if (statusCode !== 200) {
            try {
                response = JSON.parse(body);
            } catch (cause) {
                const error = new WrappedError('failed to parse error response JSON', { cause, statusCode });
                return { requestId, error, statusCode, body };
            }
            return { requestId, statusCode, error: response, response: null };
        }

        try {
            response = JSON.parse(body);
        } catch (cause) {
            const error = new WrappedError('failed to parse response body JSON', { cause, statusCode });
            return { requestId, error, statusCode, body };
        }

        return {
            requestId,
            statusCode,
            error: null,
            response,
        };
    }

    makeHttpPostRequest(url, data) {
        // See messages API:
        // https://docs.anthropic.com/en/api/messages

        return new Promise((resolve, reject) => {
            const httpClient = url.protocol === 'https:' ? https : http;
            const method = 'POST';

            const options = {
                method,
                headers: {
                    'content-type': 'application/json',
                    'anthropic-version': this.#anthropicVersion,
                    'x-api-key': this.#apiKey,
                },
            };

            const request = httpClient.request(url, options, (response) => {
                const chunks = [];

                response.on('error', (cause) => {
                    reject(new WrappedError('http response error event', { cause, statusCode: response.statusCode }));
                });

                response.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                response.on('end', (chunk) => {
                    if (chunk) {
                        chunks.push(chunk);
                    }

                    const body = Buffer.concat(chunks).toString('utf8');

                    resolve({
                        method,
                        url,
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body,
                    });
                });
            });

            request.on('error', (cause) => {
                reject(new WrappedError('http request error event', { cause }));
            });

            request.write(JSON.stringify(data));
            request.end();
        });
    }

    makeHttpGetRequest(url) {
        return new Promise((resolve, reject) => {
            const httpClient = url.protocol === 'https:' ? https : http;
            const method = 'GET';

            const options = {
                method,
                headers: {
                    'anthropic-version': this.#anthropicVersion,
                    'x-api-key': this.#apiKey,
                },
            };

            const request = httpClient.request(url, options, (response) => {
                const chunks = [];

                response.on('error', (cause) => {
                    reject(new WrappedError('http response error event', { cause, statusCode: response.statusCode }));
                });

                response.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                response.on('end', (chunk) => {
                    if (chunk) {
                        chunks.push(chunk);
                    }

                    const body = Buffer.concat(chunks).toString('utf8');

                    resolve({
                        method,
                        url,
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body,
                    });
                });
            });

            request.on('error', (cause) => {
                reject(new WrappedError('http request error event', { cause }));
            });

            request.end();
        });
    }
}
