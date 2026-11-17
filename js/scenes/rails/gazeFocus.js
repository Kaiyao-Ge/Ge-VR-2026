// Which card gets the typing keys, decided from where the head points. A card is acquired after
// a 350 ms dwell (the charge ring shows how far along), gaze on nothing keeps the current focus
// (looking down at the keyboard must not unfocus), and within 1000 ms of the last text key focus
// cannot move at all. The dwell does not count while the typing lock holds, so the person has to
// pause for a second and then look for 350 ms. Time is passed in (seconds); nothing reads a clock.
//
// State is a plain object {focus, candidate, since, charging}; `stepFocus` returns a new one
// and never changes its input. `hit` is the slot from `hitCard` (which already gives the focused
// card its 4 degree margin) or null.

export const DWELL = 0.35;
export const TYPING_LOCK = 1.0;

const EPS = 1e-9;

export const newFocus = (focus = null) => ({ focus, candidate: null, since: 0, charging: null });
export const setFocus = slot => newFocus(slot);
export const releaseFocus = () => newFocus(null);

export function stepFocus(st, { t, hit, lastTextKeyT = null }) {
   st = st || newFocus();
   const focus = st.focus;
   if (hit == null || hit === focus) return { focus, candidate: null, since: t, charging: null };
   if (lastTextKeyT != null && t - lastTextKeyT < TYPING_LOCK - EPS)         // typing: hold the dwell at zero
      return { focus, candidate: hit, since: t, charging: null };
   let since = st.candidate === hit ? st.since : t;
   // The dwell only counts once the lock is over, even if no frame was stepped at the moment it ended.
   if (lastTextKeyT != null) since = Math.max(since, lastTextKeyT + TYPING_LOCK);
   const p = Math.min(1, (t - since) / DWELL);
   if (t - since >= DWELL - EPS) return { focus: hit, candidate: null, since: t, charging: null };
   return { focus, candidate: hit, since, charging: { slot: hit, p } };
}
