export default class JobView {
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
