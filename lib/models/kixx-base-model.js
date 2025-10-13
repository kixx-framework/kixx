import crypto from 'node:crypto';
import { isUndefined } from '../assertions/mod.js';


export default class KixxBaseModel {

    constructor(props) {
        this.assignProps(props);
    }

    assignProps(props) {
        Object.assign(this, props);
        this.type = this.constructor.name;
        return this;
    }

    toRecord() {
        return Object.assign({}, this);
    }

    static genId() {
        return crypto.randomUUID();
    }

    static fromRecord(record) {
        const Model = this;

        return new Model(record);
    }

    static create(props) {
        const Model = this;

        // Avoid the expense of generating a UUID if it has already been provided.
        if (isUndefined(props.id)) {
            const id = Model.genId();
            return new Model(Object.assign({ id }, props));
        }

        return new Model(props);
    }
}
