// The design session (doc/hw5-design.md, Generation loop): the AI writes a
// draft through the tools in tools.js, reads the measured failures, fixes
// them, and ends with submit. Only a draft whose submit passed is built.
import { AIQuery } from '../../util/aiquery.js';
import { FORMS, LIMITS, MAX_JAW, PALETTE } from './design.js';
import { TOWER } from './designs/tower.js';
import { Draft, TOOLS } from './tools.js';

export const PRESETS = [
   'An Art Deco skyscraper with setbacks and a gold crown.',
   'A glass tower that twists 90 degrees from bottom to top.',
   'A terraced tower with a garden on every third floor.',
   'A brutalist block that cantilevers over its base.',
];
// tokens: output per request; a thinking model's reasoning counts toward it.
// The thinking model passed all four presets in testing; deepseek-chat passed none within 40 turns.
export const MODEL = 'deepseek-reasoner';
export const BUDGET = { turns: 40, ms: 15 * 60e3, request: 300e3, tokens: { 'deepseek-reasoner': 32000, default: 8000 } };

export const SYSTEM = `You are the construction AI of a robot building site. A player asks for a building; you design the building, the site and the build plan, and you must prove with the tools that it can really be built. You do not do physics in your head: write a draft, run the checks, read the measured failures, fix them. The tools only measure; they never change your design. Only a design whose submit returns ok is built. If your turns run out, the player sees your unfinished draft with its failures.

UNITS: metres and degrees. Origin at the centre of the table top, +y up, the table top is y = 0.

FORMAT (four parts, set separately)
components: { name: { params?: { p: default }, parts: [part] } }. A part is a primitive { form, pos, scale, rot?, color } or a use of an EARLIER component { use, pos, rot?, args? }. scale is the half-extent (a cube with scale [0.02,0.01,0.005] is 4 x 2 x 1 cm). rot is applied about X, then Y, then Z. "$p" anywhere in a part takes the value of parameter p. Forms: ${FORMS.join(', ')}. Colours: ${Object.keys(PALETTE).join(', ')}, or [r,g,b] in 0..1. At most ${LIMITS.components} components.
building: { name, origin: [x, z], floors: [{ height, turn?, modules: [{ id, use, pos, turn?, args? }] }] }. Floors stack: floor k starts at the sum of the heights below it. A module is one component instance, the part one arm carries; pos is relative to the floor's centre and base (y = 0 is the floor's base), and the component's parts are relative to the module's pos, so a cube of half-height h stands on the floor at part pos y = h (a part centred at y = 0 sticks out below the floor), turn rotates it about y and adds to the floor's turn. Ids are unique strings. At most ${LIMITS.modules} modules, ${LIMITS.primitives} primitives, top below ${LIMITS.height} m.
site: { table: [width ${LIMITS.width.join('..')}, depth ${LIMITS.depth.join('..')}], arms: [{ id, base: [x, z], yaw, lift? }], trays: [{ arm, pos: [x, z] }] }. ${LIMITS.arms.join('..')} arms. An arm with yaw θ faces [cos θ, 0, -sin θ]: yaw 0 faces +x, 90 faces -z, 180 faces -x, -90 faces +z. Every arm needs one tray.
plan: [{ step, arm, module, grasp, after? } or { step, arm, lift, after? }]. step is a unique number. Each arm runs its own steps in list order, all arms at the same time; after: [step numbers] also waits for those steps (of other arms). A lift step moves that arm's lift (0..${LIMITS.lift[1]} m) at 5 cm/s. Every module is placed by exactly one step. The whole build must take under ${LIMITS.time} s.

THE ARMS (SO101, measured with the same code that checks you)
- Each arm stands on a lift; lift is the height of its base above the table. Its tray rides with it, at the base height.
- The pan axis is 3.9 cm in front of the base position, along the facing direction. The pan turns ±110° from the facing direction.
- Grasps are top-down. The grip point is the top centre of the module's box, 1.5 cm deep. Horizontal distance from the pan axis that the grip point can be at, by its height above the arm's base: -20 cm: 4-21 cm; -15: 2-26; -10: 2-29; -5: 4-30; 0: 3-30; +3: 5-27; +6: 8-26; +9: 12-20; above +10 cm: nothing. So an arm works best 0-10 cm below its base, 10-25 cm out. To build higher, raise the lift.
- grasp is the direction in the module's own frame along which the jaws close: 0 across the module's x, 90 across its z. The module's width along that direction must be at most ${Math.round(MAX_JAW * 1000)} mm.
- Mass is volume x 400 kg/m³ (solid parts are heavy). The arm must stay under 80% of its servos' stall torque while carrying: keep modules light (thin walls, under about 100 g) and carry close.
- One module step: over the tray, down, grip, up to 3 cm above the higher of the tray and place grip points, carry straight across, down, release, up 3 cm. The tip must reach every one of these points at the arm's lift at that time. A waiting arm parks 9 cm out and 6 cm up.
- Clearance: arms must stay 10 mm from each other and from placed modules; the carried module must not pass through placed modules. Place modules so the arm never has to reach over or past taller parts it has already built, and keep arms apart in time with after.
- Bases need 12 cm between arms and 6 cm from the building; a tray is a 10 cm square plate that must not touch the building or a base.

PHYSICS (no glue): every module rests on the table or on modules below it (within 2 mm, at least 1 cm² of contact), modules never overlap, and at every height the centre of mass of everything above must be at least 5 mm inside the hull of its supports. A module placed with nothing under it falls. Cantilevers need counterweight on the supported side.
GEOMETRY: modules on one floor must not share space. At a corner, let one pair of walls run past the corner and fit the other pair between them, as in the example (long walls 16 cm wide at z ±7 cm, short walls 12 cm wide at x ±7 cm, all 2 cm thick). Make a floor's height equal to the height of the modules that carry the next floor, so the next floor rests on their tops. Results quote boxes in cm as x min..max z min..max y min..max: compute your fix from those numbers. The checks are exact; when one surprises you, the numbers say why.

TOOLS: set_components, set_building, patch_floor, check_structure, set_site, check_site, reach_report, set_plan, patch_plan, simulate_plan, submit. Work in order: components and building; site; plan; fix with patch_floor, patch_plan and set_site; then submit. Each set_ or patch_ call also returns the check it affects (check_structure, check_site or simulate_plan), so you do not need to call those separately. Call several tools in one turn whenever you can, e.g. set_components, set_building and set_site together. Do not work the whole design out in your head before the first call: send a simple first draft within your first turn and let the measurements guide you. You have ${BUDGET.turns} turns. Keep each call's arguments under 10 KB: reuse components, and for a large building send a few floors with set_building and add the rest with patch_floor.

EXAMPLE: a design that passes every check (a 4-storey tower; four arms on climbing lifts). Design something new for the player's request, but reuse what works here:
${JSON.stringify(TOWER)}`;

const CUT_OFF = 'Your reply was cut off while you were thinking. Call set_components and set_building now with a simple first draft; the tool results will tell you what to fix.';

// Earlier full copies of a part are dropped from the conversation once a
// later set_* call replaces them, which keeps every request small.
function elide(messages) {
   const latest = {};
   for (const m of messages) for (const c of m.tool_calls ?? []) if (c.function.name.startsWith('set_')) latest[c.function.name] = c;
   for (const m of messages) for (const c of m.tool_calls ?? [])
      if (c.function.name.startsWith('set_') && latest[c.function.name] !== c) c.function.arguments = '{"_note":"replaced by a later call"}';
}

// One design session. onEvent({ type: 'turn' | 'tool' | 'end', ... }) lets the
// scene show progress. Returns { ok, draft, log, messages }.
export async function designSession(prompt, { endpoint = '/api/aiquery', onEvent = () => {}, model = MODEL } = {}) {
   const ai = new AIQuery({ apiEndpoint: endpoint, timeout: BUDGET.request });
   const draft = new Draft(), start = Date.now();
   const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
   const log = { prompt, model, turns: [], calls: 0 };
   let reason = 'out of turns';
   for (let turn = 0; turn < BUDGET.turns && !draft.passed; turn++) {
      if (Date.now() - start > BUDGET.ms) { reason = 'out of time'; break; }
      const t0 = Date.now();
      let data;
      try { data = await ai.queryFull('', { messages, tools: TOOLS, tool_choice: 'auto', max_tokens: BUDGET.tokens[model] ?? BUDGET.tokens.default, model }); }
      catch (e) { reason = `request failed: ${e.message}`; break; }
      const msg = data.message ?? {}, calls = msg.tool_calls ?? [];
      const entry = { turn, ms: Date.now() - t0, text: msg.content || '', calls: [] };
      log.turns.push(entry);
      // A thinking model's reasoning goes back with its tool calls (and only then), as DeepSeek requires.
      messages.push({ role: 'assistant', content: msg.content || null, ...(calls.length && msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
         ...(calls.length ? { tool_calls: calls } : {}) });
      onEvent({ type: 'turn', turn, text: entry.text, ms: entry.ms });
      // An empty reply is a thinking model that used up its tokens: it is not kept, and the model is told once to start small.
      if (!calls.length && !msg.content) {
         messages.pop();
         if (messages.at(-1).content !== CUT_OFF) messages.push({ role: 'user', content: CUT_OFF });
         continue;
      }
      if (!calls.length) messages.push({ role: 'user', content: 'Continue with the tools. Nothing is built until submit returns ok.' });
      for (const call of calls) {
         const name = call.function.name, raw = call.function.arguments || '{}';
         let args = null, result;
         try { args = JSON.parse(raw); } catch (e) { result = `the arguments are not valid JSON (${e.message}); they may have been cut off: send smaller parts`; }
         if (args) result = await draft.call(name, args);
         log.calls++;
         entry.calls.push({ name, bytes: raw.length, result });
         messages.push({ role: 'tool', tool_call_id: call.id, content: result });
         onEvent({ type: 'tool', name, result, draft });
      }
      elide(messages);
   }
   if (draft.passed) reason = 'accepted';
   Object.assign(log, { ok: draft.passed, reason, ms: Date.now() - start, design: draft.design });
   onEvent({ type: 'end', ok: draft.passed, reason, draft });
   return { ok: draft.passed, draft, log, messages };
}
