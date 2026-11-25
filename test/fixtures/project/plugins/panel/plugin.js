export function register(context) {
    context.registerService('Panel', { title: context.config.env.PANEL.title });
}

export function initialize(context) {
    // FixtureLog belongs to the visits plugin, which this one depends on.
    context.getService('FixtureLog').events.push('panel.initialize');
}

export function start(context) {
    context.getService('FixtureLog').events.push('panel.start');
}

export function stop(context) {
    context.getService('FixtureLog').events.push('panel.stop');
}
