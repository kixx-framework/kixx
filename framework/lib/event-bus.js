// @ts-check

import { EventEmitter } from 'node:events';
import { ProgrammerError } from 'kixx-server-errors';
import KixxAssert from 'kixx-assert';

// These imports are for type checking.
// eslint-disable-next-line no-unused-vars
import { KixxEvent } from './events.js';

const { isNonEmptyString } = KixxAssert.helpers;


export default class EventBus extends EventEmitter {

    /**
     * @param  {KixxEvent} event
     * @return {Boolean}
     */
    emitEvent(event) {
        const name = event && event.name;

        if (isNonEmptyString(name)) {
            return this.emit(name, event);
        }

        throw new ProgrammerError(
            'Cannot emit event object without a String `name` property',
            { info: { event } },
            this.emit
        );
    }
}
