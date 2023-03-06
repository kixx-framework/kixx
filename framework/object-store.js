// @ts-check

import { ProgrammerError, NotFoundError } from 'kixx-server-errors';
import KixxAssert from 'kixx-assert';
import { v4 as uuidv4 } from 'uuid';

const { isNonEmptyString } = KixxAssert.helpers;


export default class ObjectStore {
    scope;
    storageEngine;

    /**
     * @param {{scope:String,storageEngine:Object}} spec
     */
    constructor(spec) {
        Object.defineProperties(this, {
            scope: {
                enumerable: true,
                value: spec.scope,
            },
            storageEngine: {
                enumerable: true,
                value: spec.storageEngine,
            },
        });
    }

    initialize(appContext) {
        return this.storageEngine.initialize(appContext).then(() => {
            return this;
        });
    }

    async readObject(id) {
        if (!isNonEmptyString(id)) {
            throw new ProgrammerError(
                'The .readObject() "id" parameter must be a non empty string.'
            );
        }

        const [ metadata, readStream ] = await this.storageEngine.readObject(id);

        if (!metadata) {
            throw new NotFoundError(
                `Requested object ${ id } could not be found`
            );
        }

        return [ metadata, readStream ];
    }

    async writeObject(metadata, readStream) {

        if (!isNonEmptyString(metadata.contentType)) {
            throw new ProgrammerError(
                'The .writeObject() "metadata.contentType" must be a non empty string.'
            );
        }

        const isoDateString = new Date().toISOString();

        const record = Object.assign({}, metadata, {
            scope: this.scope,
            type: 'object',
            id: uuidv4(),
            created: isoDateString,
            updated: isoDateString,
        });

        await this.storageEngine.writeObject(record, readStream);

        return record;
    }
}
