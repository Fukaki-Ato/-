/** Original two-tone seaside line art. Decorative images never replace live labels. */
const shapes = {
  shop: '<path d="M14 26h36v28H14z" fill="#fff9e9"/><path d="M11 26l5-15h32l5 15v6H11z" fill="#ff826b"/><path d="M24 12v19m16-19v19M26 54V39h12v15"/>',
  handbook: '<path d="M15 12h34v43H15z" fill="#fff9e9"/><path d="M21 12v43M28 23h14M28 43h14"/><path d="M35 28l3 5 6 1-4 4 1 6-6-3-5 3 1-6-4-4 6-1z" fill="#ffbb59"/>',
  chest: '<path d="M12 26h40v27H12z" fill="#ffe3a6"/><path d="M12 26c0-19 40-19 40 0M12 34h40M23 14v39m18-39v39"/><path d="M27 29h10v12H27z" fill="#ff826b"/>',
  character: '<circle cx="32" cy="22" r="12" fill="#ffe3a6"/><path d="M13 54c0-24 38-24 38 0z" fill="#71d6d2"/><path d="M20 20c5-1 10-5 12-10 1 6 7 9 12 10M25 46l7 6 7-6"/>',
  event: '<path d="M32 9v39M12 50c10-5 30-5 40 0l-7 6H19z" fill="#fff9e9"/><path d="M27 13L11 40h16z" fill="#ff826b"/><path d="M36 17l16 23H36z" fill="#fff9e9"/>',
  task: '<path d="M18 12h28v43H18z" fill="#fff9e9"/><path d="M25 9h14v8H25z" fill="#71d6d2"/><path d="M24 29l4 4 11-10m-15 19h16m-16 6h10"/>',
  achievement: '<path d="M32 9l6 14 15 2-11 11 3 16-13-8-14 8 3-16-11-11 16-2z" fill="#ffcc72"/><path d="M30 20l-3 9-8 1" stroke="#fff9e9"/>',
  rank: '<path d="M11 36h14v19H11zM25 23h14v32H25zM39 41h14v14H39z" fill="#71d6d2"/><path d="M32 5l3 6 7 1-5 5 1 6-6-3-6 3 1-6-5-5 7-1z" fill="#ffbb59"/>',
  settings: '<circle cx="32" cy="32" r="21" fill="#fff9e9"/><path d="M32 11v9m21 12h-9M32 53v-9M11 32h9m-3-15 7 7m23-7-7 7m7 23-7-7m-23 7 7-7" stroke="#ff826b" stroke-width="7"/><circle cx="32" cy="32" r="10" fill="#71d6d2"/>',
} as const;

export function coastalIcon(name: keyof typeof shapes): HTMLImageElement {
  const image = document.createElement('img');
  image.alt = '';
  image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#18596a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shapes[name]}</svg>`)}`;
  return image;
}
