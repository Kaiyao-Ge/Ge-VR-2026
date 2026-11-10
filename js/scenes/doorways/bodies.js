// The partner's body in Doorways, from what the network gives: for a partner in the headset,
// its head and hands in clientState, in ITS model frame (clientState.head(id), .hand(id, side));
// for one on a desktop, which has no head there, the body its snapshot carries. Pure: the
// clientState is passed in, so that this runs in Node on a fake one.
//
// A body is { head, left, right }: matrices, a hand null when it is not there; or null for
// no body (nothing yet, or numbers that cannot be drawn). A snapshot body is { head, left?, right? }.
//
//   modelBody:  the partner as its own client frames it (its model frame);
//   peerBody:   in the table frame, which both clients share (inv(peer.table) * its model frame;
//               a desktop giant's snapshot body is in the table frame already);
//   giantFigure / miniFigure: what the Avatar draws in MY model frame, with the feet, for the
//               giant seen by the mini (at its real size) and the mini seen by the giant.
import * as cg from '../../render/core/cg.js';
import { TABLE } from '../miniature/world.js';

const isMatrix = m => !!m && m.length === 16 && Array.prototype.every.call(m, v => typeof v === 'number' && Number.isFinite(v));
const copy = m => Array.from(m);
const SIDES = ['left', 'right'];

// A snapshot's body, checked: the head must be a matrix, a hand a matrix or not there. Null if it is not that.
export const readBody = b => {
   if (!b || typeof b !== 'object' || !isMatrix(b.head)) return null;
   if (!SIDES.every(s => b[s] === undefined || b[s] === null || isMatrix(b[s]))) return null;
   return { head: copy(b.head), left: b.left ? copy(b.left) : null, right: b.right ? copy(b.right) : null };
};

// The partner as its own client frames it, or null.
export const modelBody = (peer, snapshotBody, clientState) => {
   if (!peer) return null;
   if (!peer.xr) return readBody(snapshotBody);
   try {
      const head = clientState.head(peer.id);
      if (!isMatrix(head)) return null;
      const hand = side => { const m = clientState.hand(peer.id, side); return isMatrix(m) ? copy(m) : null; };
      return { head: copy(head), left: hand('left'), right: hand('right') };
   } catch (_) { return null; }   // a half-built clientState must not stop a frame
};

// The partner in the table frame, or null: a desktop partner's snapshot body is that already; an XR
// partner's head and hands go through the inverse of its table matrix (null if that is missing or singular).
export const peerBody = (peer, snapshotBody, clientState) => {
   const b = modelBody(peer, snapshotBody, clientState);
   if (!b || !peer.xr) return b;
   if (!isMatrix(peer.table)) return null;
   const inv = cg.mInverse(peer.table);
   if (!isMatrix(inv)) return null;
   const to = m => m && cg.mMultiply(inv, m);
   return { head: to(b.head), left: to(b.left), right: to(b.right) };
};

// Poses mapped by a matrix, hands only where there are hands; the feet under the head at height y of the source frame.
const figure = (M, body, floor) => ({
   poses: { head: cg.mMultiply(M, body.head), left: body.left && cg.mMultiply(M, body.left), right: body.right && cg.mMultiply(M, body.right) },
   feet: cg.mTransform(M, [body.head[12], floor, body.head[14]]),
});

// The giant at its real size, in my model frame: F is my table's frame. Its feet are on the floor of its own
// world, where its table matrix says that is (the table's height below the table's frame), else the standard table's.
export const giantFigure = (F, peer, snapshotBody, clientState) => {
   const b = peerBody(peer, snapshotBody, clientState);
   if (!b) return null;
   const floor = isMatrix(peer.table) ? cg.mTransform(cg.mInverse(peer.table), [0, 0, 0])[1] : -TABLE.height;
   return figure(F, b, Number.isFinite(floor) ? floor : -TABLE.height);
};

// The mini's avatar in my model frame (I am the giant): F * pose(ref) * map * its body in ITS model frame, where
// pose is where the room it stands in is now (held or settled) and map takes its real body to its avatar relative
// to that room as its client sees it (pair.mapOf).
export const miniFigure = (F, pose, map, peer, snapshotBody, clientState) => {
   const b = modelBody(peer, snapshotBody, clientState);
   return b && figure(cg.mMultiply(F, cg.mMultiply(pose, map)), b, 0);
};
