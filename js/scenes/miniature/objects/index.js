// The objects that can sit on the table. Each module exports create(node);
// cube.js describes what it returns. Add a new one here and name it in
// miniature.js.
import * as cube from './cube.js';
import * as house from './house.js';

export const OBJECTS = { house, cube };
