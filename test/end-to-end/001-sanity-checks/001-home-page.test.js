import { FastHTMLParser } from 'fast-html-dom-parser';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/target-url.js';
import validateHtml from '../test-helpers/validate-html.js';


describe('home page HTML', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        url = new URL(getBaseUrl());
        response = await fetch(url);
        body = await response.text();
    });

    it('returns the home page HTML', () => {
        assert(response);
        assertEqual(200, response.status);
        assertEqual(url.href, response.url);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        // Match a sample of the HTML document, just to be sure there is something there.
        assertMatches('<!doctype html>', body.slice(0, 50));
    });

    it('renders valid HTML', async () => {
        // The response body is a full HTML document, so it can be validated directly.
        await validateHtml(body);
        const document = new FastHTMLParser(body);
        const [ bodyNode ] = document.getElementsByTagName('body');
        assertEqual('BODY', bodyNode.nodeName);
    });
});
