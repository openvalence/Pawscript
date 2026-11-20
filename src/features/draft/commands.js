// commands.js -- "Draft script" (menu Track). draft.run shows the steps and runs what is pending (a finished run is
// just shown: Run all again is one click; a first run over an existing plan / points waits for Run all, under the
// dialog's 'Replaces ...' warning). args.timeline (director timeline JSON, string or value) + args.name = the
// import hook: the plan step then uses importTimeline instead of the rule table.
import { draftFor, peekDraft } from './draft.svelte.js';
import { guard } from '../../app/commands.js';

export default [
  {
    id: 'draft.run', title: 'Draft script (scenes, tags, plan, base track, generate)', keys: ['Ctrl+Shift+D'], menu: 'Track', group: 'draft',
    when: guard((app) => !!app.doc.media, 'Open a video first'),
    run: (app, args) => {
      const D = draftFor(app);
      if (args?.timeline) { try { D.setTimeline(args.timeline, args.name); } catch (e) { app.toast('Timeline not usable: ' + (e?.message || e), 'error'); return; } }
      D.show = true;
      const fresh = D.view.every((s) => s.status === 'idle');
      if (!D.busy && !D.complete && !(fresh && D.replaces)) D.runAll();
    },
  },
  { id: 'draft.show', title: 'Draft script: show the steps', menu: 'Track', group: 'draft', run: (app) => { draftFor(app).show = true; } },
  { id: 'draft.cancel', title: 'Draft script: cancel', menu: 'Track', group: 'draft', when: guard((app) => !!peekDraft(app)?.busy, 'No draft is running'), run: (app) => peekDraft(app)?.cancel() },
];
