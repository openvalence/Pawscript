// commands-overview.js -- overview strip options.
export default [
  { id: 'timeline.overview.metric', title: 'Overview: show mean / peak speed', menu: 'View', group: 'timeline',
    run: (app) => app.settings.set('timeline.overviewMetric', app.settings.get('timeline.overviewMetric', 'mean') === 'peak' ? 'mean' : 'peak') },
];
