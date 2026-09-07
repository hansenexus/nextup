/**
 * Small dependency-graph helpers: cycle detection and a stable topological
 * order. Used for `depends_on` between items and `blocked_by` between tasks.
 *
 * Kahn's algorithm with the input order as the tie-breaker, so the result is
 * deterministic and reads like the file: two independent tasks come out in
 * the order they were written, not in hash order.
 */

export interface TopoResult {
  order: string[];
  /** Nodes that could not be ordered because they sit on (or behind) a cycle. */
  cycle: string[];
}

export function topoSort(
  nodes: readonly string[],
  edgesOf: (id: string) => readonly string[]
): TopoResult {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n, 0);
    dependents.set(n, []);
  }
  for (const n of nodes) {
    for (const dep of edgesOf(n)) {
      if (!indegree.has(dep)) continue; // unknown refs are a validation matter, not a graph one
      indegree.set(n, (indegree.get(n) ?? 0) + 1);
      dependents.get(dep)?.push(n);
    }
  }
  const order: string[] = [];
  const ready = nodes.filter((n) => indegree.get(n) === 0);
  while (ready.length > 0) {
    const n = ready.shift();
    if (n === undefined) break;
    order.push(n);
    for (const d of dependents.get(n) ?? []) {
      const left = (indegree.get(d) ?? 1) - 1;
      indegree.set(d, left);
      if (left === 0) {
        // keep file order among the newly-ready
        const idx = nodes.indexOf(d);
        let at = ready.length;
        while (at > 0 && nodes.indexOf(ready[at - 1] ?? "") > idx) at--;
        ready.splice(at, 0, d);
      }
    }
  }
  const placed = new Set(order);
  return { order, cycle: nodes.filter((n) => !placed.has(n)) };
}

/** Every node reachable from `start` by following `edgesOf`, excluding `start`. */
export function reachable(start: string, edgesOf: (id: string) => readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...edgesOf(start)];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    stack.push(...edgesOf(n));
  }
  return seen;
}
