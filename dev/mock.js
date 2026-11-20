// dev/mock.js -- smoke page for dev/mock-app.js: builds the mock, exercises edit/undo/keys, prints the result.
import { createMockApp } from './mock-app.js';
const app = createMockApp();
const out = [];
const s0 = app.doc.axes.stroke;
out.push('stroke ' + s0.length + ' roll ' + app.doc.axes.roll.length + ' dur ' + app.durationMs);
app.player.seek(1234);
app.commands.run('edit.point5');
out.push('after point5: ' + app.doc.axes.stroke.length + ' dirty ' + app.doc.dirty + ' undo ' + app.history.undoLabel);
app.undo();
out.push('after undo same array: ' + (app.doc.axes.stroke === s0) + ' dirty ' + app.doc.dirty);
out.push('commands ' + app.commands.list().length + ' conflicts ' + JSON.stringify(app.commands.conflicts()));
document.getElementById('out').textContent = out.join('\n');
