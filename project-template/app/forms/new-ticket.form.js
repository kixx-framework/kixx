export default class NewTicketForm {

    target = 'CreateNewTicket';

    fields = [
        {
            type: 'text',
            name: 'title',
            label: 'Title',
        },
        {
            type: 'text',
            name: 'description',
            label: 'Description',
        },
        {
            type: 'singleSelect',
            name: 'priority',
            label: 'Priority',
            options: [],
        },
        {
            type: 'multiSelect',
            name: 'tags',
            label: 'Tags',
            options: [],
        },
    ];

    #context = null; // eslint-disable-line no-unused-private-class-members
    #logger = null; // eslint-disable-line no-unused-private-class-members

    constructor(context) {
        this.#context = context;
        this.#logger = context.logger.createChild(this.constructor.name);
    }

    getField(name) {
        return this.fields.find((field) => field.name === name);
    }

    setFormData() {
    }
}
