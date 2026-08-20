const prefetched = new Set<string>();

export function prefetchRoute(key: string, importFn: () => Promise<unknown>) {
  if (prefetched.has(key)) return;
  prefetched.add(key);

  importFn().catch(() => {
    prefetched.delete(key);
  });
}
