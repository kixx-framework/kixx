import config from './cloudflare-config.generated.js';
import { greet } from './lib/greet.js';

export default {
    fetch() {
        return new Response(greet(config.name));
    },
};

export class ContentAddressableIndexStore {}
