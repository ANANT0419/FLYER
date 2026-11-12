// One address, two faces: the game on the big screen, or (with ?pad=CODE) the phone that steers it.
const pad = new URLSearchParams(location.search).get('pad');
if (pad) import('./pad.js').then(m => m.startPad(pad));
else import('./game.js');
