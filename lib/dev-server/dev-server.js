import http from 'node:http';
import { createHttpRequestHandler } from './http-request-handler.js';

export default class DevServer {
    startServer(logger, port, target) {

        const handleRequest = createHttpRequestHandler(logger, target);

        const server = http.createServer({
            // This keepAlive setting does not seem to have an impact
            // either way.
            // keepAlive: true,
            //
            // This keepAliveTimeout setting will update the
            // Keep-Alive timeout=n value. Default is 5 seconds.
            // keepAliveTimeout: 5 * 1000,
            //
            // These timeout options were not found to be reliable in testing. First, there is no
            // easy way to test the headers timeout. Secondly, the request timeout will often allow
            // a request to go way beyond the configured timeout limit.
            //
            // Sets the timeout value in milliseconds for receiving the complete HTTP headers
            // from the client. Default: 60000
            // headersTimeout: 20 * 1000,
            // Sets the timeout value in milliseconds for receiving the entire request from
            // the client. Default: 300000
            // requestTimeout: 60 * 1000,
        });

        server.once('error', function onServerError(error) {
            logger.error('server error event', null, error);
        });

        server.once('listening', function onServerListening() {
            const addr = server.address();
            logger.info('server listening', { port: addr.port });
        });

        server.on('request', handleRequest);

        server.listen(port);

        return server;
    }
}
