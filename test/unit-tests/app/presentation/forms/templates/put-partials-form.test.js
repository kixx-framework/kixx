import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import PutPartialsForm from '../../../../../../src/app/presentation/forms/templates/put-partials-form.js';


describe('PutPartialsForm', ({ it }) => {
    it('accepts an empty partial set', () => {
        const form = PutPartialsForm.fromJsonApi({ attributes: { partials: [] } });

        form.validate();

        assertEqual(0, form.toJSON().partials.length);
    });

    it('preserves source text exactly, without trimming', () => {
        const form = PutPartialsForm.fromJsonApi({
            attributes: {
                partials: [ { filepath: 'nav.html', source: '  <nav>\t</nav>  \n' } ],
            },
        });

        form.validate();

        assertEqual('  <nav>\t</nav>  \n', form.toJSON().partials[0].source);
    });

    it('folds a safe filepath to lower case without trimming it', () => {
        const form = PutPartialsForm.fromJsonApi({
            attributes: {
                partials: [ { filepath: 'Shared/Nav.HTML', source: '<nav/>' } ],
            },
        });

        form.validate();

        assertEqual('shared/nav.html', form.toJSON().partials[0].filepath);
    });

    it('ignores unknown attributes and unknown entry properties', () => {
        const form = PutPartialsForm.fromJsonApi({
            attributes: {
                partials: [ { filepath: 'nav.html', source: '<nav/>', extra: 'ignored' } ],
                unknownAttribute: 'ignored',
            },
        });

        form.validate();
        const values = form.toJSON();

        assertEqual(1, values.partials.length);
        assertEqual('nav.html', values.partials[0].filepath);
        assertEqual('<nav/>', values.partials[0].source);
        assertEqual(undefined, values.partials[0].extra);
    });

    it('rejects a non-array partials value', () => {
        const form = PutPartialsForm.fromJsonApi({ attributes: { partials: 'nope' } });

        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'partials' ]);
    });

    it('rejects a missing filepath', () => {
        const form = new PutPartialsForm({ partials: [ { source: '<nav/>' } ] });

        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'partials[0].filepath' ]);
    });

    it('rejects a missing source', () => {
        const form = new PutPartialsForm({ partials: [ { filepath: 'nav.html' } ] });

        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'partials[0].source' ]);
    });

    it('rejects traversal, leading, trailing, and doubled slash filepaths', () => {
        const badFilepaths = [ '../nav.html', '/nav.html', 'nav.html/', 'nav//footer.html' ];

        for (const filepath of badFilepaths) {
            const form = new PutPartialsForm({ partials: [ { filepath, source: '<nav/>' } ] });
            const caught = catchError(() => form.validate());

            assertValidationSources(caught, [ 'partials[0].filepath' ]);
        }
    });

    it('rejects a filepath with disallowed characters', () => {
        const form = new PutPartialsForm({ partials: [ { filepath: 'nav file.html', source: '<nav/>' } ] });

        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'partials[0].filepath' ]);
    });

    it('reports every applicable field error across the whole batch, not just the first', () => {
        const form = new PutPartialsForm({
            partials: [
                { filepath: '', source: '<nav/>' },
                { filepath: 'footer.html', source: '' },
            ],
        });

        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'partials[0].filepath', 'partials[1].source' ]);
    });

    it('rejects duplicate filepaths that collide only after case-folding normalization', () => {
        const form = new PutPartialsForm({
            partials: [
                { filepath: 'Nav.html', source: '<nav/>' },
                { filepath: 'nav.html', source: '<nav-2/>' },
            ],
        });

        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'partials[1].filepath' ]);
    });
});

function assertValidationSources(error, expectedSources) {
    assert(error, 'expected a ValidationError');
    assertEqual('ValidationError', error.name);
    assertEqual(expectedSources.join(','), error.errors.map(({ source }) => source).join(','));
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
