const TIERS = [
  {
    name: 'low', dpr: 1, shadow: 1024, physics: 'none', seg: 3, env: false, post: false, view: 'flat',
  },
  {
    name: 'medium', dpr: 1.5, shadow: 2048, physics: 'drop', seg: 4, env: true, post: false, view: '3d',
  },
  {
    name: 'high', dpr: 2, shadow: 2048, physics: 'full', seg: 6, env: true, post: true, view: '3d',
  },
];

export const tierOf = (device, n) => {
  const base = TIERS[Math.min(2, Math.max(0, device === 0 ? 0 : device - 1))];
  return {
    ...base,
    seg: n > 2000 ? 3 : Math.min(base.seg, n > 800 ? 4 : 6),
    physics: base.physics === 'full' && n > 1200 ? 'drop' : base.physics,
  };
};

export const STEPS = [{ post: false }, { dpr: 1 }, { shadow: 1024, physics: 'drop' }, { physics: 'none', env: false }];

export const CAMERA = { fov: 30, tilt: (34 * Math.PI) / 180 };
export const POUR_LIMIT = 320;
