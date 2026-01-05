class Database {
    async initialize() {
        Object.defineProperty(this, 'initialized', {
            enumerable: true,
            value: true,
        });
        return this;
    }
}

class Hyperview {
    async initialize() {
        Object.defineProperty(this, 'initialized', {
            enumerable: true,
            value: true,
        });
        return this;
    }
}

class RootUser {
    id = 'root-user-fixture';
}

export function register(context) {
    context.registerService('Database', new Database());
    context.registerService('Hyperview', new Hyperview());

    context.setRootUser(new RootUser(context));
}

export async function initialize(context) {
    const db = context.getService('Database');
    const views = context.getService('Hyperview');

    await db.initialize();
    await views.initialize();
}
