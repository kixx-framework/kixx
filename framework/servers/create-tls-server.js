// @ts-check

import path from 'node:path';
import fs from 'node:fs';
import tls from 'node:tls';
// Some of these imports are for type checking.
/* eslint-disable no-unused-vars */
import https, { Server } from 'node:https';
import { Logger } from 'kixx-logger';
import { OperationalError, ProgrammerError } from 'kixx-server-errors';
import ApplicationConfig from '../configuration/application-config.js';
import EventBus from '../lib/event-bus.js';
/* eslint-enable no-unused-vars */
import { ErrorEvent, InfoEvent } from '../lib/events.js';

/**
 * @typedef {Object} TLSServerParams
 * @prop {EventBus} eventBus
 * @prop {Logger} logger
 * @prop {Number} port
 * @prop {Array<ApplicationConfig>} applications
 * @prop {String|null} sslCertificateDirectory
 */

/**
 * @param  {TLSServerParams} params
 * @param  {Function} requestHandler
 * @return {Promise<Server>}
 */
export default function createTLSServer(params, requestHandler) {
    const {
        eventBus,
        logger,
        port,
        applications,
        sslCertificateDirectory,
    } = params;

    return new Promise(function startTLSServerPromise(resolve, reject) {
        let maps;
        try {
            maps = loadSSLCertificates(applications, port, sslCertificateDirectory);
        } catch (cause) {
            reject(new OperationalError(
                'Error while loading SSL certificate data',
                {
                    cause,
                    fatal: true,
                    code: 'SSL_CERT_LOAD_ERROR',
                },
                createTLSServer
            ));
            return;
        }

        const { certMap, keyMap, hostnameMap } = maps;
        const server = https.createServer({ SNICallback: sniCallback });

        let resolved = false;

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

        function sniCallback(servername, callback) {
            let ctx;

            try {
                // In a Server Name Indication scheme (SNI) the servername is the hostname on the request.
                const certName = hostnameMap.get(servername);

                ctx = tls.createSecureContext({
                    cert: certMap.get(certName),
                    key: keyMap.get(certName),
                });
            } catch (cause) {
                logger.error('sni callback unable to create secure context', { port, servername, cause });

                const error = new OperationalError(
                    'Unable to create TLS Secure Context',
                    {
                        cause,
                        fatal: true,
                        code: 'TLS_SECURE_CONTEXT_ERROR',
                        info: { port, servername },
                    },
                    createTLSServer
                );

                emitError(error);
                callback(error);
                return;
            }

            callback(null, ctx);
        }

        server.on('error', (cause) => {
            logger.error('error event from the tls server', { port, cause });

            const error = new OperationalError('Server error event', {
                cause,
                fatal: true,
                code: 'SERVER_ERROR_EVENT',
                info: { port, encrypted: true },
            });

            emitError(error);
        });

        server.on('listening', () => {
            logger.info('tls server listening', { port });

            eventBus.emitEvent(new InfoEvent({
                type: 'SERVER_START',
                message: `server listening on port ${ port }`,
                info: { port, encrypted: true },
            }));

            resolvePromise();
        });

        // The TypeScript interpretation of this function signature is bonkers.
        // @ts-ignore
        server.on('request', requestHandler);

        server.listen(port);
    });
}

function loadSSLCertificates(applications, port, sourceDirectory) {
    const directoryStat = fs.statSync(sourceDirectory, { throwIfNoEntry: false });

    if (!directoryStat) {
        throw new ProgrammerError(
            `SSL certificate source directory not present: ${ sourceDirectory }`,
            {
                fatal: true,
                info: { directory: sourceDirectory },
            },
            createTLSServer
        );
    }

    if (!directoryStat.isDirectory()) {
        throw new ProgrammerError(
            `SSL certificate source is not a directory: ${ sourceDirectory }`,
            {
                fatal: true,
                info: { directory: sourceDirectory },
            },
            createTLSServer
        );
    }

    // Iterate through the configuration for each virtual host.
    return applications.reduce((maps, appConfig) => {
        const { certMap, keyMap, hostnameMap } = maps;
        const { ports, hostnames } = appConfig;

        // If this virtual host is configured to listen on unencrypted ports then we
        // do not need to load a certificate for it.
        if (!ports.includes(port)) {
            return maps;
        }

        hostnames.forEach(({ hostname, certificate }) => {
            // For legibility: This is a String, not an object.
            const certificateName = certificate;

            if (!certMap.has(certificateName)) {
                certMap.set(certificateName, loadSSLCertificateFile(sourceDirectory, certificateName));
                keyMap.set(certificateName, loadSSLKeyFile(sourceDirectory, certificateName));
            }

            // Hostnames may share the same SSL cert. ex: "www.example.com" and "example.com".
            // Map the hostname to the SSL certificate name.
            hostnameMap.set(hostname, certificateName);
        });

        return maps;
    }, { certMap: new Map(), keyMap: new Map(), hostnameMap: new Map() });
}

function loadSSLCertificateFile(directory, name) {
    const filepath = path.join(directory, `${ name }.cert`);
    try {
        return fs.readFileSync(filepath);
    } catch (cause) {
        throw new ProgrammerError(
            `SSL certificate file not present: ${ filepath }`,
            {
                cause,
                info: { filepath },
            },
            createTLSServer
        );
    }
}

function loadSSLKeyFile(directory, name) {
    const filepath = path.join(directory, `${ name }.key`);
    try {
        return fs.readFileSync(filepath);
    } catch (cause) {
        throw new ProgrammerError(`SSL key file unreadable: ${ filepath }`,
            {
                cause,
                info: { filepath },
            },
            createTLSServer
        );
    }
}
