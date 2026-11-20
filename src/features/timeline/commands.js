// commands.js -- every timeline command. Each piece keeps its own commands-<piece>.js (default export Command[]);
// this file only gathers them, so pieces never edit a shared file.
const mods = import.meta.glob('./commands-*.js', { eager: true });
export default Object.keys(mods).sort().flatMap((k) => mods[k].default || []);
