import { env } from 'cloudflare:workers';
import { createWorker } from '../../../kixx/adapters/cloudflare/server/lib/cloudflare-worker.js';
import sourceConfig from './cloudflare-config.generated.js';
import * as registry from './cloudflare-registry.generated.js';
import virtualHosts from './virtual-hosts.js';
import * as app from './app/app.js';

export * from './cloudflare-durable-objects.generated.js';

export default createWorker({ env, sourceConfig, registry, virtualHosts, app });
