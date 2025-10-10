import crypto from 'node:crypto';


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
        const id = Model.genId();
        return new Model(Object.assign({ id }, props));
    }
}
