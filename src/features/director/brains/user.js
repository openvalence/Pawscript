// user.js -- the user brain never answers in the chain: decide() queues the request (status 'queued', the best answer
// so far applied as provisional) and the Director panel's cards answer later as overrides.
import { KINDS } from '../../../lib/director/decisions.js';

export const userBrain = {
  id: 'user', kinds: KINDS,
  available: async () => true,
  decide: async (reqs) => reqs.map((r) => ({ id: r.id, abstain: 'queued' })),
};
