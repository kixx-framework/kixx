import Job from './job.model.js';

export default class JobCollection {

    static Model = Job;

    constructor(context, schema) {
        Object.defineProperties(this, {
            context: {
                enumerable: true,
                value: context,
            },
            schema: {
                enumerable: true,
                value: schema,
            },
        });
    }
}
