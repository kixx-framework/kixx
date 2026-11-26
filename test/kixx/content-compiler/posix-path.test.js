import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { basename, dirname, extname } from '../../../kixx/content-compiler/posix-path.js';


describe('content-compiler/posix-path', ({ it }) => {
    it('basename() returns the last segment and ignores a trailing slash', () => {
        assertEqual('page.html', basename('pages/about/page.html'));
        assertEqual('page.html', basename('/page.html'));
        assertEqual('page.html', basename('page.html'));
        assertEqual('page.html', basename('nested/page.html/'));
        assertEqual('', basename('/'));
        assertEqual('', basename(''));
    });

    it('dirname() returns everything before the last slash', () => {
        assertEqual('pages/about', dirname('pages/about/page.html'));
        assertEqual('/about', dirname('/about/page.html'));
        assertEqual('', dirname('/page.html'));
        assertEqual('', dirname('page.json'));
    });

    it('extname() returns the last segment\'s extension', () => {
        assertEqual('.css', extname('stylesheets/site.css'));
        assertEqual('.js', extname('app.min.js'));
        assertEqual('', extname('stylesheets.v2/readme'));
        assertEqual('', extname('.css'));
        assertEqual('.', extname('name.'));
    });
});
