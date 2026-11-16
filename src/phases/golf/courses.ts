// The five mini golf holes (state.mini.map 0..4). Grids are 20 cols x 30 rows of 6px tiles (120x180 course pixels).
// Tiles: ' ' solid (walls / scenery), '.' fairway, ',' fairway (alt shade), 's' sand, 'w' water, '^ v < >' slope (pushes
// that way), 'b' bridge (fairway over water), '=' railroad track (fairway).
// Objects: circles (tables, cacti, rocks, bumpers, barrels), boxes (static or moving), tunnels (enter A -> exit B).

export type Theme = 'saloon' | 'canyon' | 'rail' | 'grave' | 'mine';
export interface Circ { x: number; y: number; r: number; kind: 'table' | 'cactus' | 'rock' | 'bumper' | 'barrel' }
export interface Box {
  x: number; y: number; w: number; h: number;
  kind: 'chair' | 'bar' | 'door' | 'cart' | 'trough' | 'stone' | 'crate';
  /** ping-pong (dx/dy over period seconds, eased) or loop (constant vx px/s wrapping over span) */
  move?: { dx?: number; dy?: number; period?: number; phase?: number; loop?: number; span?: number };
}
export interface Tunnel { ax: number; ay: number; bx: number; by: number; dx: number; dy: number }
export interface Course {
  name: string; sub: string; par: number; theme: Theme;
  grid: string[];
  tee: [number, number]; hole: [number, number];
  circles: Circ[]; boxes: Box[]; tunnels: Tunnel[];
  /** railroad: track rows for drawing rails through the walls */
  tracks?: number[];
}

const g = (rows: string[]) => {
  const out = rows.map((r) => r.padEnd(20, ' ').slice(0, 20));
  while (out.length < 30) out.push(' '.repeat(20));
  return out.slice(0, 30);
};
const rep = (s: string, n: number) => Array.from({ length: n }, () => s);

const SALOON: Course = {
  name: 'The Saloon Floor', sub: 'Mind the tables. The batwing door swings.', par: 2, theme: 'saloon',
  grid: g([
    '                    ',
    '   ..............   ',
    ...rep('  ................  ', 9),
    '   ..............   ',
    '        vvvv        ',
    '        vvvv        ',
    '        vvvv        ',
    '   ..............   ',
    ...rep('  ................  ', 12),
    '   ..............   ',
    '                    ',
  ]),
  tee: [60, 160], hole: [92, 20],
  circles: [
    { x: 62, y: 44, r: 7, kind: 'table' }, { x: 30, y: 58, r: 7, kind: 'table' }, { x: 94, y: 62, r: 6, kind: 'table' },
    { x: 34, y: 118, r: 7, kind: 'table' }, { x: 86, y: 128, r: 7, kind: 'table' },
  ],
  boxes: [
    { x: 14, y: 8, w: 30, h: 8, kind: 'bar' },
    { x: 19, y: 64, w: 4, h: 4, kind: 'chair' }, { x: 70, y: 36, w: 4, h: 4, kind: 'chair' }, { x: 102, y: 66, w: 4, h: 4, kind: 'chair' },
    { x: 24, y: 126, w: 4, h: 4, kind: 'chair' }, { x: 96, y: 120, w: 4, h: 4, kind: 'chair' },
    { x: 48, y: 79, w: 12, h: 3, kind: 'door', move: { dx: 12, period: 2.6 } },
  ],
  tunnels: [],
};

const CANYON: Course = {
  name: 'Dry Gulch Canyon', sub: 'The old riverbed still runs east.', par: 3, theme: 'canyon',
  grid: g([
    '                    ',
    '           ......   ',
    '          ........  ',
    '          ........  ',
    '         .........  ',
    '         ..ss.....  ',
    '        ...sss....  ',
    '        ..........  ',
    '       ...........  ',
    '      ............  ',
    '     .............  ',
    '    ..............  ',
    ' >>>>>>>>>>>>>>>>>  ',
    ' >>>>>>>>>>>>>>>>>  ',
    ' >>>>>>>>>>>>>>>>>  ',
    ' .........          ',
    ' ........           ',
    ...rep(' ........           ', 11),
    '  ......            ',
    '                    ',
  ]),
  tee: [26, 162], hole: [92, 18],
  circles: [
    { x: 34, y: 124, r: 3, kind: 'cactus' }, { x: 16, y: 104, r: 3, kind: 'cactus' },
    { x: 56, y: 82, r: 4, kind: 'rock' },
    { x: 62, y: 56, r: 3, kind: 'cactus' }, { x: 100, y: 40, r: 3, kind: 'cactus' }, { x: 80, y: 62, r: 4, kind: 'rock' },
  ],
  boxes: [],
  tunnels: [],
};

const RAIL: Course = {
  name: 'Railroad Crossing', sub: 'Two lines, no signals. Time it.', par: 2, theme: 'rail',
  grid: g([
    '                    ',
    '    ............    ',
    '   ..............   ',
    ...rep('  ................  ', 6),
    '  ================  ',
    '  ================  ',
    ...rep('  ................  ', 8),
    '  ================  ',
    '  ================  ',
    ...rep('  ................  ', 7),
    '   ..............   ',
    '                    ',
  ]),
  tee: [60, 164], hole: [60, 20],
  tracks: [9, 19],
  circles: [{ x: 26, y: 88, r: 4, kind: 'barrel' }, { x: 94, y: 96, r: 4, kind: 'barrel' }, { x: 28, y: 146, r: 4, kind: 'barrel' }],
  boxes: [
    { x: 46, y: 30, w: 28, h: 6, kind: 'trough' },
    { x: -26, y: 55, w: 26, h: 10, kind: 'cart', move: { loop: 46, span: 146 } },
    { x: -30, y: 115, w: 30, h: 10, kind: 'cart', move: { loop: -58, span: 150, phase: 0.4 } },
  ],
  tunnels: [],
};

const GRAVE: Course = {
  name: 'Boot Hill', sub: 'One narrow bridge. Don\'t wake the dead.', par: 3, theme: 'grave',
  grid: g([
    '                    ',
    '  ...............   ',
    ' .................. ',
    ' ..........sss..... ',
    ' ..........ss...... ',
    ...rep(' .................. ', 8),
    ' wwwwwwwwbbwwwwwwww ',
    ' wwwwwwwwbbwwwwwwww ',
    ' wwwwwwwwbbwwwwwwww ',
    ...rep(' .................. ', 12),
    '  ................  ',
    '                    ',
  ]),
  tee: [24, 164], hole: [94, 18],
  circles: [],
  boxes: [
    { x: 30, y: 34, w: 5, h: 7, kind: 'stone' }, { x: 50, y: 24, w: 5, h: 7, kind: 'stone' }, { x: 70, y: 46, w: 5, h: 7, kind: 'stone' },
    { x: 100, y: 52, w: 5, h: 7, kind: 'stone' }, { x: 20, y: 62, w: 5, h: 7, kind: 'stone' }, { x: 84, y: 66, w: 5, h: 7, kind: 'stone' },
    { x: 46, y: 64, w: 5, h: 7, kind: 'stone' },
    { x: 40, y: 128, w: 5, h: 7, kind: 'stone' }, { x: 82, y: 140, w: 5, h: 7, kind: 'stone' }, { x: 100, y: 116, w: 5, h: 7, kind: 'stone' },
    { x: 14, y: 112, w: 5, h: 7, kind: 'stone' },
  ],
  tunnels: [],
};

const MINE: Course = {
  name: 'The Gold Mine', sub: 'Bumpers, a mine shaft, and a flooded pit.', par: 3, theme: 'mine',
  grid: g([
    '                    ',
    '  ................  ',
    ' .................. ',
    ' .................. ',
    ' .......wwwww...... ',
    ' ......wwwwwww..... ',
    ' .......wwwww...... ',
    ...rep(' .................. ', 5),
    ' vv                 ',
    ' vv                 ',
    ' vv                 ',
    ' vv                 ',
    ' vv                 ',
    ' vv                 ',
    ...rep(' .................. ', 10),
    '  ................  ',
    '                    ',
  ]),
  tee: [30, 162], hole: [24, 20],
  circles: [
    { x: 58, y: 140, r: 4, kind: 'bumper' }, { x: 80, y: 124, r: 4, kind: 'bumper' }, { x: 62, y: 114, r: 4, kind: 'bumper' },
    { x: 54, y: 58, r: 4, kind: 'bumper' }, { x: 92, y: 30, r: 4, kind: 'bumper' }, { x: 30, y: 50, r: 4, kind: 'bumper' },
  ],
  boxes: [{ x: 96, y: 150, w: 8, h: 8, kind: 'crate' }],
  tunnels: [{ ax: 104, ay: 128, bx: 104, by: 62, dx: -1, dy: -0.35 }],
};

export const COURSES: Course[] = [SALOON, CANYON, RAIL, GRAVE, MINE];
export const courseFor = (map: number | undefined) => COURSES[(((map ?? 0) % 5) + 5) % 5];
