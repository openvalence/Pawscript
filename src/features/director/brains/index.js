// index.js -- the brain registry (README §4). rules, replay and user are always present; vlm when opts.vlmModel is
// set; agent when a mailbox (agentRoot + io) or CDP is enabled.
import { rulesBrain } from './rules.js';
import { makeVlmBrain } from './vlm.js';
import { makeAgentBrain } from './agent.js';
import { userBrain } from './user.js';
import { makeReplayBrain } from './replay.js';

/**
 * opts: {vlmModel?, agentRoot?, cdp?} (contract) plus
 *   io?       app.backend-like {writeText, readText, listDir, remove, mkdir?} for the mailbox
 *   session?  mailbox session folder name ('dr-YYYYMMDD-HHMMSS')
 *   replay?   {[id]: {value, rationale, conf}} (trace.js fromTrace2)
 *   vlm?      {quant, res} for director.ask;  pollMs? mailbox poll interval (500)
 */
export function makeBrains(opts = {}) {
  const b = { rules: rulesBrain, replay: makeReplayBrain(opts.replay ?? {}), user: userBrain };
  if (opts.vlmModel) b.vlm = makeVlmBrain({ model: opts.vlmModel, ...(opts.vlm ?? {}) });
  if (opts.agentRoot || opts.cdp) b.agent = makeAgentBrain({ io: opts.io, root: opts.agentRoot, session: opts.session, cdp: !!opts.cdp, pollMs: opts.pollMs });
  return b;
}

export { rulesBrain, makeVlmBrain, makeAgentBrain, userBrain, makeReplayBrain };
