const COUNTER_KEY = 'fixture/visits/count';


// Counts visits in the key/value store, so a request goes through a port
// that each target implements with its own adapter.
class Visits {

    #keyValueStore = null;

    setKeyValueStore(keyValueStore) {
        this.#keyValueStore = keyValueStore;
    }

    async increment(context) {
        const stored = await this.#keyValueStore.get(context, COUNTER_KEY, { type: 'json' });
        const count = (stored?.count ?? 0) + 1;

        await this.#keyValueStore.put(context, COUNTER_KEY, { count }, { type: 'json' });

        return count;
    }
}


export function register(context) {
    // Every lifecycle module in the fixture records its hooks here, in order.
    context.registerService('FixtureLog', { events: [] });
    context.registerService('Visits', new Visits());
}

export function initialize(context) {
    context.getService('Visits').setKeyValueStore(context.getService('KeyValueStore'));

    // Declared under templateHelpers in plugin.json.
    context.getService('HyperviewService').registerTemplateHelper('visitCount', (_context, _options, count) => {
        return count === 1 ? '1 visit' : `${ count } visits`;
    });
}

export function start(context) {
    context.getService('FixtureLog').events.push('visits.start');
}

export function stop(context) {
    context.getService('FixtureLog').events.push('visits.stop');
}
