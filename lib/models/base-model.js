export default class BaseModel {

    constructor(collection, props) {
        Object.defineProperties(this, {
            collection: {
                value: collection,
            },
        });

        this.assignProps(props);
    }

    assignProps(props) {
        Object.assign(this, props);
        this.type = this.constructor.name;
        return this;
    }
}
