import { startNodeServer } from '../../../kixx/adapters/node/server/lib/node-server.js';
import * as registry from './node-registry.generated.js';
import virtualHosts from './virtual-hosts.js';
import * as app from './app/app.js';

await startNodeServer({ registry, virtualHosts, app, baseDirectory: import.meta.dirname });
