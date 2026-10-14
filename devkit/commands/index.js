import * as admin from './admin/index.js';
import * as app from './app/index.js';
import * as cloudflare from './cloudflare/index.js';


// Command name to command index module. Static imports, rather than reading
// this directory, keep every command in the module graph when the CLI is
// loaded from a registry URL or compiled into a single executable.
export default {
    admin,
    app,
    cloudflare,
};
