import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ApplicationContext from '../../../../src/kixx/context/application-context.js';
import ContentAddressableStore from '../../../../src/kixx/content-addressable-store/content-addressable-store.js';
import HyperviewService from '../../../../src/kixx/hyperview/hyperview-service.js';
import DeveloperContentStore from '../../../../src/plugins/node-content-store/lib/developer-content-store.js';
import Mailer from '../../../../src/plugins/mailer/lib/mailer.js';
import EmailSender from '../../../../src/plugins/node-email-sender/lib/email-sender.js';
import * as mailerPlugin from '../../../../src/plugins/mailer/plugin.js';
import * as nodeEmailSenderPlugin from '../../../../src/plugins/node-email-sender/plugin.js';
import * as generalPlugins from '../../../../src/plugins/general.js';
import * as nodePlugins from '../../../../src/plugins/node.js';

function makeLogger() {
    const output = [];
    const logger = {
        output,
        debug() {},
        info(...args) {
            output.push(args);
        },
        warn() {},
        error() {},
        createChild() {
            return this;
        },
    };
    return logger;
}

describe('Mailer example email composition', ({ it }) => {
    it('renders the committed bundle through DeveloperContentStore and logs it through Node', async () => {
        const logger = makeLogger();
        const root = path.resolve('src');
        const contentStore = new DeveloperContentStore({
            logger,
            pagesDirectory: path.join(root, 'pages'),
            templatesDirectory: path.join(root, 'templates'),
            staticAssetsDirectory: path.join(root, 'static-assets'),
            emailsDirectory: path.join(root, 'emails'),
        });
        const contentAddressableStore = new ContentAddressableStore();
        contentAddressableStore.initialize({ logger, contentStore });
        const hyperviewService = new HyperviewService({ logger });
        hyperviewService.initialize({
            contentAddressableStore,
            kvStore: {
                async get() {
                    return null;
                },
                async put() {},
            },
        });
        const nodeSender = new EmailSender({ logger });
        const mailer = new Mailer();
        mailer.initialize({ hyperviewService, emailSender: nodeSender });

        try {
            const result = await mailer.send({
                runtime: { build: { id: 'developer' } },
            }, '/example', {
                to: 'reader@example.com',
                data: { name: '<Sam>' },
            });

            assert(result.messageId);
            const emailLogs = logger.output.filter(([ message ]) => message === 'logged email message');
            assertEqual(1, emailLogs.length);
            const details = emailLogs[0][1];
            assertEqual('reader@example.com', details.to);
            assertEqual('A note for &lt;Sam&gt;', details.subject);
            assertEqual('<p>Hello &lt;Sam&gt;,</p>\n<p>This is a sample message from Kixx.</p>\n', details.html);
            assertEqual('Hello <Sam>,\n\nThis is a sample message from Kixx.\n', details.text);
        } finally {
            contentStore.close();
        }
    });

    it('registers Mailer and the platform EmailSender in their plugin maps', () => {
        assert(generalPlugins.plugins.has('mailer'));
        assert(nodePlugins.plugins.has('nodeEmailSender'));
    });

    it('wires Mailer only during plugin initialization', () => {
        const logger = makeLogger();
        const context = new ApplicationContext({ config: { env: {} }, logger, env: {}, runtime: { mode: 'server' } });
        const hyperviewService = {};
        const emailSender = {};
        context.registerService('HyperviewService', hyperviewService);
        context.registerService('EmailSender', emailSender);

        mailerPlugin.register(context);
        nodeEmailSenderPlugin.register(context);
        mailerPlugin.initialize(context);
        const mailer = context.getService('Mailer');

        assert(mailer instanceof Mailer);
        assert(context.getService('EmailSender') instanceof EmailSender);
    });
});
