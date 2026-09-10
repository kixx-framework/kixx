import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import {
    getContentDisposition,
    getFileEtag,
    matchesIfNoneMatch,
} from '../../../../../src/app/presentation/lib/file-response.js';

describe('file-response', ({ it }) => {
    it('uses the committed generation as a quoted validator', () => {
        assertEqual('"generation-2"', getFileEtag(makeFile('image/png', 'photo.png')));
    });

    it('weakly matches lists and the wildcard', () => {
        assertEqual(true, matchesIfNoneMatch('"old", W/"generation-2"', '"generation-2"'));
        assertEqual(true, matchesIfNoneMatch('*', '"generation-2"'));
        assertEqual(false, matchesIfNoneMatch('"old"', '"generation-2"'));
    });

    it('serves safe browser media inline and markup as an attachment', () => {
        assertEqual('inline; filename="photo.png"; filename*=UTF-8\'\'photo.png',
            getContentDisposition(makeFile('image/png', 'photo.png')));
        assertEqual('attachment; filename="page.html"; filename*=UTF-8\'\'page.html',
            getContentDisposition(makeFile('text/html', 'page.html')));
    });

    it('encodes Unicode and neutralizes quoted fallback characters', () => {
        assertEqual(
            'attachment; filename="r_sum__.xml"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%22.xml',
            getContentDisposition(makeFile('application/xml', 'résumé".xml')),
        );
    });

    it('forces every admin download to attachment disposition', () => {
        assertEqual('attachment; filename="photo.png"; filename*=UTF-8\'\'photo.png',
            getContentDisposition(makeFile('image/png', 'photo.png'), true));
    });
});

function makeFile(contentType, filename) {
    return { content: { contentType, filename, generation: 'generation-2' } };
}
