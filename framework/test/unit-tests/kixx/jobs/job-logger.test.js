import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import JobLogger from '../../../../src/kixx/jobs/job-logger.js';


describe('JobLogger', ({ it }) => {
    it('forwards each level with the job fields merged into the info', () => {
        const { logger, entries } = makeLogger();
        const jobLogger = new JobLogger(logger, { jobId: 'j1', jobName: 'one' });
        const error = new Error('x');

        jobLogger.debug('d', { a: 1 });
        jobLogger.info('i', { a: 2 });
        jobLogger.warn('w', { a: 3 });
        jobLogger.error('e', { a: 4 }, error);

        assertEqual('debug,info,warn,error', entries.map((e) => e.level).join(','));
        assertEqual('j1', entries[0].info.jobId);
        assertEqual('one', entries[0].info.jobName);
        assertEqual(4, entries[3].info.a);
        assertEqual(error, entries[3].error);
    });

    it('lets the entry info override the job fields', () => {
        const { logger, entries } = makeLogger();

        new JobLogger(logger, { jobId: 'j1', jobName: 'one' }).info('i', { jobName: 'other' });

        assertEqual('other', entries[0].info.jobName);
    });

    it('supplies the fields alone when no info is given', () => {
        const { logger, entries } = makeLogger();

        new JobLogger(logger, { jobId: 'j1', jobName: 'one' }).info('i');

        assertEqual('j1', entries[0].info.jobId);
    });

    it('keeps non-object info under an info key', () => {
        const { logger, entries } = makeLogger();

        new JobLogger(logger, { jobId: 'j1', jobName: 'one' }).warn('w', 'detail');

        assertEqual('detail', entries[0].info.info);
        assertEqual('j1', entries[0].info.jobId);
    });

    it('exposes the parent logger name and level', () => {
        const { logger } = makeLogger();
        const jobLogger = new JobLogger(logger, { jobId: 'j1', jobName: 'one' });

        assertEqual('app', jobLogger.name);
        assertEqual('INFO', jobLogger.level);
    });
});

function makeLogger() {
    const entries = [];
    const record = (level) => (message, info, error) => {
        entries.push({ level, message, info, error });
    };

    return {
        entries,
        logger: {
            name: 'app',
            level: 'INFO',
            debug: record('debug'),
            info: record('info'),
            warn: record('warn'),
            error: record('error'),
        },
    };
}
