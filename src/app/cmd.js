// cmd.js -- a control bound to a command (paw-m3b6 step 1, Blender's operator button): spread the props on a kit Button /
// IconButton and the button IS the command. Its click runs it; it is greyed while the command's `when` is false (the reason,
// its `why`, in the tooltip; still hoverable and right-clickable: kit Button turns `disabled` into aria-disabled on a
// [data-command] control); pressed from the command's `checked(app)`; tooltip = its title and tip (or the words given here);
// shortcut = its current key (never written by hand); data-command (the Quick menu / Assign shortcut right click).
//   <Button {...cmd(app, 'track.run')} icon="crosshair">Track ROI</Button>
//   <IconButton label="Flip" icon="swap" {...cmd(app, 'track.flipRun', undefined, { tip: 'Flip the whole run' })} />
// args go to run (the Quick menu replays the id alone). Options: the control's own words in place of title + tip; before(e)
// runs first on a click (a usage note). Props written after the spread win (a contextual tooltip, pressed).
export function cmd(app, id, args, { tip, before } = {}) {
  const r = app?.commands, c = r?.get?.(id);
  if (!c) return { disabled: true };   // feature not loaded: a dead button
  const on = r.enabled(id), why = on ? '' : r.whyNot(id);
  let pressed;
  try { pressed = c.checked ? !!c.checked(app) : undefined; } catch { pressed = false; }
  const words = [tip ?? [c.title, c.tip].filter(Boolean).join('\n'), why].filter(Boolean).join('\n');
  return {
    'data-command': id,
    disabled: !on,
    ...(pressed !== undefined && { pressed }),
    tip: words,
    shortcut: r.keyOk?.(id) === false ? '' : r.keysFor(id)[0] || '',   // paw-5zpf: only where its key reaches it (F flips in Track, fills in Refine)
    onclick: (e) => { before?.(e); r.run(id, args); },
  };
}
