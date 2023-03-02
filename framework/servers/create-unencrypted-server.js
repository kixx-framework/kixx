// @ts-check

// Some of these imports are for type checking.

/* eslint-disable no-unused-vars */
import http, { Server } from 'node:http';
import { Logger } from 'kixx-logger';
import { OperationalError } from 'kixx-server-errors';
import EventBus from '../lib/event-bus.js';
/* eslint-enable no-unused-vars */
import { ErrorEvent, InfoEvent } from '../lib/events.js';


/**
 * @typedef {Object} UnencryptedServerParams
 * @prop {EventBus} eventBus
 * @prop {Logger} logger
 * @prop {Number} port
 */

/**
 * @param  {UnencryptedServerParams} params
 * @param  {Function} requestHandler
 * @return {Promise<Server>}
 */
export default function createUnencryptedServer(params, requestHandler) {
    const {
        eventBus,
        logger,
        port,
    } = params;

    return new Promise(function startUnencryptedServerPromise(resolve, reject) {
        let resolved = false;
        const server = http.createServer();

        function emitError(error) {
            if (resolved) {
                eventBus.emitEvent(new ErrorEvent(error));
            } else {
                resolved = true;
                reject(error);
            }
        }

        function resolvePromise() {
            if (!resolved) {
                resolved = true;
                resolve(server);
            }
        }

        server.on('error', (cause) => {
            logger.error('error event from the unencrypted server', { port, cause });

            const error = new OperationalError('Server error event', {
                cause,
                fatal: true,
                code: 'SERVER_ERROR_EVENT',
                info: { port, encrypted: false },
            });

            emitError(error);
        });

        server.on('listening', () => {
            logger.info('unencrypted server listening', { port });

            eventBus.emitEvent(new InfoEvent({
                type: 'SERVER_START',
                message: `server listening on port ${ port }`,
                info: { port, encrypted: false },
            }));

            resolvePromise();
        });

        // The TypeScript interpretation of this function signature is bonkers.
        // @ts-ignore
        server.on('request', requestHandler);

        server.listen(port);
    });
}
