/* FietsNav smoke tests — pure-logic unit tests for the routing/navigation core.
   Runs app.js inside a mocked-browser sandbox (no DOM, no network needed) and
   exercises the geometry + turn-computation + comparison functions.
   Run:  npm test   (or)   node test/smoke.test.js                              */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// One chainable proxy absorbs every DOM / Leaflet call made at module load.
const P = new Proxy(function () {}, {
  get(t, p) { if (p === Symbol.iterator) return function* () {}; if (p === 'length') return 0; if (p === 'then') return undefined; return P; },
  apply() { return P; }, construct() { return P; }, set() { return true; }, has() { return false; }
});
const sandbox = {
  L: P, document: P, window: P,
  navigator: { geolocation: { getCurrentPosition() {}, watchPosition() { return 1; }, clearWatch() {} } },
  location: { protocol: 'file:', origin: 'file://' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout, clearTimeout, console, fetch: () => P, innerWidth: 1200, innerHeight: 800
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const EXPORTS = '\n;globalThis.__T={haversine,bearing,compass,fmtD,fmtT,cumulative,rdpKeep,classifyTurn,buildTurns,parseName,namesFromMessages,turnText,compareCard,state};';
vm.runInContext(code + EXPORTS, sandbox, { filename: 'app.js' });
const T = sandbox.__T;
if (!T) { console.log('FAIL: app.js did not load / export'); process.exit(1); }
console.log('app.js loads with no reference errors ✓\n');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + '  ' + e)); };

console.log('-- geo math --');
const d = T.haversine([52.3731, 4.8922], [52.0907, 5.1214]);
ok('haversine Amsterdam->Utrecht ~35km', d > 30000 && d < 40000, '(' + Math.round(d) + 'm)');
ok('bearing east ~90', Math.abs(T.bearing([52, 5], [52, 5.01]) - 90) < 2);
ok('compass(90)=east', T.compass(90) === 'east');

console.log('-- formatting --');
ok('fmtD(205)=210 m', T.fmtD(205) === '210 m', '(' + T.fmtD(205) + ')');
ok('fmtD(2158)=2.2 km', T.fmtD(2158) === '2.2 km', '(' + T.fmtD(2158) + ')');
ok('fmtT(3720)=1 h 2 min', T.fmtT(3720) === '1 h 2 min', '(' + T.fmtT(3720) + ')');

console.log('-- turn classification --');
ok('+90 -> right', T.classifyTurn(90) === 'right');
ok('-90 -> left', T.classifyTurn(-90) === 'left');
ok('+25 -> slight-right', T.classifyTurn(25) === 'slight-right');
ok('170 -> uturn', T.classifyTurn(170) === 'uturn');
ok('10 -> null (no turn)', T.classifyTurn(10) === null);

console.log('-- buildTurns on L-shaped route (east then north) --');
const coords = [];
for (let i = 0; i < 5; i++) coords.push([52.100, 5.100 + i * 0.003]);
for (let i = 1; i <= 4; i++) coords.push([52.100 + i * 0.003, 5.112]);
const cum = T.cumulative(coords);
const turns = T.buildTurns(coords, cum, new Array(coords.length).fill(null));
ok('cumulative monotonic', cum.every((v, i) => i === 0 || v > cum[i - 1]));
ok('depart -> turn -> arrive', turns.length === 3 && turns[0].type === 'depart' && turns[2].type === 'arrive');
ok('east->north detected as LEFT', turns[1] && turns[1].type === 'left', '(got ' + (turns[1] && turns[1].type) + ')');

console.log('-- street names from BRouter messages (best effort) --');
ok('parseName multiword', T.parseName('highway=cycleway name=Jan van Galenstraat surface=asphalt') === 'Jan van Galenstraat');
ok('parseName none->null', T.parseName('highway=path surface=gravel') === null);

console.log('-- turnText --');
ok('left + name', T.turnText({ type: 'left', name: 'Dorpsstraat' }) === 'Turn left onto Dorpsstraat');
ok('arrive', T.turnText({ type: 'arrive' }) === 'Arrive at destination');

console.log('-- shortest-bike-route comparison card --');
T.state.compare = { dist: 12400, time: 1680, coords: [] };
T.state.showRoadRoute = false;
const card = T.compareCard({ dist: 14200, time: 3000 });
ok('labelled "shortest bike route"', /shortest bike route/i.test(card));
ok('delta +1.8 km longer', card.includes('+1.8 km') && card.includes('longer'));
ok('shows percentage', card.includes('15%'));
ok('"most direct bike route" note', card.includes('most direct bike route'));
ok('comparison time uses cycling speed, not BRouter walking time', card.includes('44 min') && !card.includes('28 min'));
T.state.compare = { dist: 9000, time: 1200, coords: [], isSame: true };
ok('same-route notice when profile=shortest', /already on the/i.test(T.compareCard({ dist: 9000, time: 1200 })));
T.state.compare = null;
ok('no card without comparison', T.compareCard({ dist: 1000, time: 300 }) === '');

console.log('\n========== ' + pass + ' passed, ' + fail + ' failed ==========');
process.exit(fail ? 1 : 0);
