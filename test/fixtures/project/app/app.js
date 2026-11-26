// The app's lifecycle module. It runs after every plugin's.

export function initialize(context) {
    // Throws when the declared secret didn't reach the app. Its value is
    // never put in the log.
    context.getEnvString('FIXTURE_APP_SECRET', { required: true });

    // Declared under templateHelpers in app.json.
    context.getService('HyperviewService').registerTemplateHelper('fixtureGreeting', (_context, _options, name) => {
        return `Hello, ${ name }`;
    });

    context.getService('FixtureLog').events.push('app.initialize');
}

export function start(context) {
    context.getService('FixtureLog').events.push('app.start');
}

export function stop(context) {
    context.getService('FixtureLog').events.push('app.stop');
}
