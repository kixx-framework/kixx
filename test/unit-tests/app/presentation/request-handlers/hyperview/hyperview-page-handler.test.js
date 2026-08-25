import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import HyperviewPageHandler from '../../../../../../src/app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';


describe('HyperviewPageHandler', ({ it }) => {

    it('delegates rendering to the shared facade contract', async () => {
        const calls = [];
        const context = {
            getService(name) {
                assertEqual('HyperviewService', name);
                return {
                    async renderPage(_context, options) {
                        calls.push({ options });
                        return { type: 'hypertext', hypertext: '<main>Account</main>' };
                    },
                };
            },
        };
        const request = {
            headers: new Headers({ 'kixx-partial': 'summary' }),
            url: new URL('https://www.example.com/account'),
        };
        const response = new ServerResponse();
        const handler = HyperviewPageHandler({
            pathname: '/account',
            baseTemplateId: 'default.html',
        });

        const returned = await handler(context, request, response);

        assertEqual(response, returned);
        assertEqual(1, calls.length);
        assertEqual('/account', calls[0].options.pathname);
        assertEqual('default.html', calls[0].options.baseTemplateId);
        assertEqual('summary', calls[0].options.partial);
        assertEqual('<main>Account</main>', response.body);
    });
});
