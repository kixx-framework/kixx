import User from './user.model.js';

export default class UserCollection {

    static Model = User;

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
