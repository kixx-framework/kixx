export default class KixxBaseModel {

    constructor(collection, props) {
        this.assignProps(props);

        Object.defineProperties(this, {
            collection: {
                enumerable: false,
                value: collection,
            },
        });
    }

    assignProps(props) {
        Object.assign(this, props);
        this.type = this.constructor.name;
        return this;
    }
}
