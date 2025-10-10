export default class KixxBaseModel {

    constructor(props) {
        this.assignProps(props);
    }

    assignProps(props) {
        Object.assign(this, props);
        this.type = this.constructor.name;
        return this;
    }
}
