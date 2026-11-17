// A pool of nodes below one parent, made when a frame first needs them and never freed: a frame allocates nothing, and what a frame
// does not use is hidden (`ignore`), not removed. `make(parent)` makes one node.
export class NodePool {
   constructor(parent, make) {
      this.parent = parent; this.make = make;
      this.nodes = [];
      this.shown = 0;                 // one past the highest node taken since the last hideFrom
   }
   get size() { return this.nodes.length; }
   // The i-th node, made if there is none yet, and shown.
   take(i) {
      const n = this.nodes[i] || (this.nodes[i] = this.make(this.parent));
      n.ignore = false;
      if (i >= this.shown) this.shown = i + 1;
      return n;
   }
   // Hides the i-th node if it is made and shown.
   hide(i) {
      const n = this.nodes[i];
      if (n && !n.ignore) n.ignore = true;
   }
   // Hides every node from the n-th on that was taken (`also(node)` for each of them, to let go of what it carries), as the frame is done with them.
   hideFrom(n, also) {
      for (let i = n; i < this.shown; i++) { this.nodes[i].ignore = true; if (also) also(this.nodes[i]); }
      if (n < this.shown) this.shown = n;
   }
}
