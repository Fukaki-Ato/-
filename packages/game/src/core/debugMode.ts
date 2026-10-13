/** Shared by the page gateway and runtime; presence enables QA, including encoded/mixed-case keys. */
export function debugQueryFlags(search: string): { debug: boolean; test: boolean; qa: boolean } {
  let debug = false, test = false, qa = false;
  new URLSearchParams(search).forEach((value, name) => {
    const key = name.toLowerCase();
    if (key === 'debug') debug = true;
    if (key === 'test') test = true;
    if (key === 'anim' || key === 'ui' && value.toLowerCase() === 'demo') qa = true;
  });
  return { debug, test: debug || test, qa: debug || test || qa };
}
