export const COUNTS = [100, 150, 200, 250, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000];
export const DEFAULT_COUNT = 500;

export const COLLECTION = [
  {
    key: 'burano',
    photo: 'photo-1491900177661-4e1cd2d7cce2',
    name: 'Burano at Dusk',
    desc: 'Blue boats moored between the painted houses of Burano, in the Venetian Lagoon.',
    credit: 'Fabio Mangione',
  },
  {
    key: 'torii',
    photo: 'photo-1558862107-d49ef2a04d72',
    name: 'Senbon Torii',
    desc: 'The tunnel of vermilion gates climbing Mount Inari at Fushimi Inari Taisha, Kyoto.',
    credit: 'David Emrich',
  },
  {
    key: 'reine',
    photo: 'photo-1593378026483-2a1fd46a35bd',
    name: 'Aurora over Reine',
    desc: 'Green aurora above the snowy peaks and fishing village of Reine, Lofoten.',
    credit: 'Johny Goerend',
  },
  {
    key: 'macaw',
    photo: 'photo-1612024782955-49fae79e42bb',
    name: 'Macaw in Full Color',
    desc: 'Blue, yellow and orange plumage, close enough to count the feathers.',
    credit: 'Dmitry Chernyshov',
  },
  {
    key: 'mongkok',
    photo: 'photo-1616394158624-a2ba9cfe2994',
    name: 'Mong Kok at Night',
    desc: 'Red minibuses threading a neon-lit street in Kowloon, Hong Kong.',
    credit: 'Chi Hung Wong',
  },
  {
    key: 'bulbs',
    photo: 'photo-1556724890-91cd6fc35fa9',
    name: 'Bulb Fields in Bloom',
    desc: 'Rows of tulips striping the spring fields in bands of color.',
    credit: 'Alfons Taekema',
  },
  {
    key: 'balloons',
    photo: 'photo-1695415683093-ae5f213ea898',
    name: 'Balloons at First Light',
    desc: 'A sky full of hot-air balloons drifting over the valleys of Cappadocia.',
    credit: 'Musa Ortaç',
  },
  {
    key: 'spices',
    photo: 'photo-1713607763620-dbfe9c10b3ff',
    name: 'The Spice Merchant',
    desc: 'Open sacks of ground spices, heaped high and sorted by color.',
    credit: 'Andy Kennedy',
  },
  {
    key: 'reef',
    photo: 'photo-1708649290066-5f617003b93f',
    name: 'Reef Garden',
    desc: 'A coral reef in every color, seen from just above the water.',
    credit: 'NEOM',
  },
];

export const photoUrl = (photo, width, quality = 82) => `https://images.unsplash.com/${photo}?w=${width}&q=${quality}&fm=jpg&fit=max`;

export const TABLETOPS = [
  {
    key: 'felt', name: 'Felt', tone: 'dark', color: '#1d5136', ph: 'caban', credit: 'Material from Poly Haven', span: 13.7, rough: 1, bump: 1, gain: 1, tint: [29, 81, 54],
  },
  {
    key: 'cork', name: 'Cork', tone: 'light', color: '#b48a5c', photo: 'photo-1657044300845-65507ee16d86', credit: 'Photo by Valery Sysoev on Unsplash', crop: 0.4, scale: 0.6, shade: [1, 1, 1], flat: 3, span: 9, rough: 0.92, bump: 0.7, gain: 0.9,
  },
  {
    key: 'bamboo', name: 'Bamboo', tone: 'light', color: '#d9b98a', ph: 'bamboo_veneer', credit: 'Material from Poly Haven', span: 50, rough: 1, bump: 1, gain: 1, sharp: true,
  },
  {
    key: 'oak', name: 'Oak', tone: 'light', color: '#b08d57', ph: 'oak_veneer_01', credit: 'Material from Poly Haven', span: 55, rough: 1, bump: 1, gain: 1, sharp: true,
  },
  {
    key: 'walnut', name: 'Walnut', tone: 'dark', color: '#4a3020', ph: 'walnut_veneer', credit: 'Material from Poly Haven', span: 55, rough: 1, bump: 1, gain: 0.5, sharp: true,
  },
  {
    key: 'linen', name: 'Linen', tone: 'light', color: '#cfc3a6', ph: 'rough_linen', credit: 'Material from Poly Haven', span: 13.5, rough: 1, bump: 1, gain: 1, tint: [207, 195, 166],
  },
  {
    key: 'leather', name: 'Leather', tone: 'dark', color: '#7a4a22', ph: 'fabric_leather_02', credit: 'Material from Poly Haven', span: 25, rough: 1, bump: 0.6, gain: 0.72,
  },
  {
    key: 'hessian', name: 'Hessian', tone: 'light', color: '#b39a6b', ph: 'hessian_230', credit: 'Material from Poly Haven', span: 13.4, rough: 1, bump: 0.8, gain: 1,
  },
  {
    key: 'baize', name: 'Navy baize', tone: 'dark', color: '#22304f', ph: 'velour_velvet', credit: 'Material from Poly Haven', span: 14.2, rough: 1, bump: 1, gain: 1, tint: [34, 48, 79],
  },
  {
    key: 'kraft', name: 'Kraft', tone: 'light', color: '#b08e62', photo: 'photo-1616410731309-4e07df6b5d42', credit: 'Photo by Kiwihug on Unsplash', crop: 0.9, scale: 0.5, shade: [1, 1, 1], flat: 24, span: 16, rough: 0.88, bump: 1.6, gain: 0.85,
  },
];

export const HELP = [
  {
    title: 'The pieces',
    rows: [
      ['Move a piece or a joined section', 'Drag it', 'Drag it'],
      ['Turn it', 'Drag it by its edge, scroll while holding it, or press <kbd>Q</kbd> or <kbd>E</kbd> over it. Add <kbd>Shift</kbd> for a quarter turn. Settings chooses which of the first two are on', 'Drag it by its edge, or keep it held and twist with a second finger'],
      ['Flip it over', 'Double-click it, or press <kbd>F</kbd> over it', 'Double-tap it'],
      ['Join two pieces', 'Drop one beside its true neighbor, turned roughly the right way. Face-down pieces never join', 'The same'],
      ['Sweep up a handful', '<kbd>Shift</kbd>-drag across the table, then drag any one of them', 'Press and hold the table, drag across, then drag any one of them'],
      ['Let a handful go', 'Press Put down, press <kbd>Esc</kbd>, or click the table', 'Press Put down, or tap the table'],
    ],
  },
  {
    title: 'The table',
    rows: [
      ['Pan', 'Drag the table, drag with the middle button, or press the arrow keys', 'Drag the table'],
      ['Zoom', 'Scroll, press <kbd>+</kbd> and <kbd>−</kbd>, or use the zoom buttons. Press the percentage to go back to 100%. Settings can turn zooming off', 'Pinch, or use the zoom buttons'],
      ['Spin the table', 'Right-drag or <kbd>Alt</kbd>-drag and let go to let it coast, <kbd>Alt</kbd>-scroll, or press <kbd>[</kbd> and <kbd>]</kbd>. Add <kbd>Shift</kbd> for a quarter turn', 'Twist with two fingers, or press Spin'],
      ['Switch between 3D and HD-2D', 'Press <kbd>V</kbd>, or choose in Settings', 'Choose in Settings'],
      ['See every piece', 'Press Fit, or <kbd>0</kbd>', 'Press Fit'],
      ['Undo and redo', '<kbd>{mod}</kbd><kbd>Z</kbd> and <kbd>Shift</kbd><kbd>{mod}</kbd><kbd>Z</kbd>', 'Tap the arrows in the bottom corner'],
      ['Look at the box', 'Click the lid badge in the corner. <kbd>Esc</kbd> lays it down', 'Tap the lid badge'],
      ['Open this guide', 'Press <kbd>?</kbd>', 'Tap the question mark in the corner'],
    ],
  },
];

export const NOTES = [
  'Everything saves as you go. Close the tab and every piece will be where you left it.',
  'The clock only counts while you are working. It pauses when you step away.',
  'Assists flip, square, gather edges and spread the pile for you. Turn them off in Settings for an honest table.',
  'Undo remembers your moves until the puzzle leaves the table.',
  'Change the tabletop at any time in Settings, for one puzzle or for all of them.',
];
