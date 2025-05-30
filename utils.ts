import { createMemo, getOwner, runWithOwner } from "solid-js";
import type {
  MatchFilter,
  MatchFilters,
  PathMatch,
  RouteDescription,
  SearchParams,
  SetSearchParams,
} from "./types.ts";

const hasSchemeRegex = /^(?:[a-z0-9]+:)?\/\//i;
const trimPathRegex = /^\/+|(\/)\/+$/g;
export const mockBase = "http://sr";

export function normalizePath(path: string, omitSlash = false) {
  const s = path.replace(trimPathRegex, "$1");
  return s ? (omitSlash || /^[?#]/.test(s) ? s : `/${s}`) : "";
}

export function resolvePath(base: string, path: string, from?: string): string | undefined {
  if (hasSchemeRegex.test(path)) {
    return undefined;
  }
  const basePath = normalizePath(base);
  const fromPath = from && normalizePath(from);
  let result = "";
  if (!fromPath || path.startsWith("/")) {
    result = basePath;
  } else if (fromPath.toLowerCase().indexOf(basePath.toLowerCase()) !== 0) {
    result = basePath + fromPath;
  } else {
    result = fromPath;
  }
  return (result || "/") + normalizePath(path, !result);
}

export function invariant<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

export function joinPaths(from: string, to: string): string {
  return normalizePath(from).replace(/\/*(\*.*)?$/g, "") + normalizePath(to);
}

export function extractSearchParams(url: URL): SearchParams {
  const params: SearchParams = {};
  url.searchParams.forEach((value, key) => {
    if (key in params) {
      if (Array.isArray(params[key])) (params[key] as string[]).push(value);
      else params[key] = [params[key] as string, value];
    } else params[key] = value;
  });
  return params;
}

export function createMatcher<S extends string>(
  path: S,
  partial?: boolean,
  matchFilters?: MatchFilters<S>,
) {
  const [pattern, splat] = path.split("/*", 2);
  const segments = pattern.split("/").filter(Boolean);
  const len = segments.length;

  return (location: string): PathMatch | null => {
    const locSegments = location.split("/").filter(Boolean);
    const lenDiff = locSegments.length - len;
    if (lenDiff < 0 || (lenDiff > 0 && splat === undefined && !partial)) {
      return null;
    }

    const match: PathMatch = {
      path: len ? "" : "/",
      params: {},
    };

    const matchFilter = (s: string) =>
      matchFilters === undefined ? undefined : (matchFilters as Record<string, MatchFilter>)[s];

    for (let i = 0; i < len; i++) {
      const segment = segments[i];
      const dynamic = segment[0] === ":";
      const locSegment = dynamic ? locSegments[i] : locSegments[i].toLowerCase();
      const key = dynamic ? segment.slice(1) : segment.toLowerCase();

      if (dynamic && matchSegment(locSegment, matchFilter(key))) {
        match.params[key] = locSegment;
      } else if (dynamic || !matchSegment(locSegment, key)) {
        return null;
      }
      match.path += `/${locSegment}`;
    }

    if (splat) {
      const remainder = lenDiff ? locSegments.slice(-lenDiff).join("/") : "";
      if (matchSegment(remainder, matchFilter(splat))) {
        match.params[splat] = remainder;
      } else {
        return null;
      }
    }

    return match;
  };
}

function matchSegment(input: string, filter?: string | MatchFilter): boolean {
  const isEqual = (s: string) => s === input;

  if (filter === undefined) return true;
  if (typeof filter === "string") return isEqual(filter);
  if (typeof filter === "function") return filter(input);
  if (Array.isArray(filter)) return (filter as string[]).some(isEqual);
  if (filter instanceof RegExp) return (filter as RegExp).test(input);

  return false;
}

export function scoreRoute(route: RouteDescription): number {
  const [pattern, splat] = route.pattern.split("/*", 2);
  const segments = pattern.split("/").filter(Boolean);
  return segments.reduce(
    (score, segment) => score + (segment.startsWith(":") ? 2 : 3),
    segments.length - (splat === undefined ? 0 : 1),
  );
}

export function createMemoObject<T extends Record<string | symbol, unknown>>(fn: () => T): T {
  const map = new Map();
  const owner = getOwner()!;
  return new Proxy({} as T, {
    get(_, property) {
      if (!map.has(property)) {
        runWithOwner(owner, () =>
          map.set(
            property,
            createMemo(() => fn()[property]),
          ),
        );
      }
      return map.get(property)();
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true,
      };
    },
    ownKeys() {
      return Reflect.ownKeys(fn());
    },
  });
}

export function mergeSearchString(search: string, params: SetSearchParams) {
  const merged = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
      merged.delete(key);
    } else {
      if (Array.isArray(value)) {
        // Delete all instances of the key before appending
        merged.delete(key);
        for (const v of value) {
          merged.append(key, String(v));
        }
      } else {
        merged.set(key, String(value));
      }
    }
  }
  const s = merged.toString();
  return s ? `?${s}` : "";
}

export function expandOptionals(pattern: string): string[] {
  let match = /(\/?\:[^\/]+)\?/.exec(pattern);
  if (!match) return [pattern];

  let prefix = pattern.slice(0, match.index);
  let suffix = pattern.slice(match.index + match[0].length);
  const prefixes: string[] = [prefix, (prefix += match[1])];

  // This section handles adjacent optional params. We don't actually want all permuations since
  // that will lead to equivalent routes which have the same number of params. For example
  // `/:a?/:b?/:c`? only has the unique expansion: `/`, `/:a`, `/:a/:b`, `/:a/:b/:c` and we can
  // discard `/:b`, `/:c`, `/:b/:c` by building them up in order and not recursing. This also helps
  // ensure predictability where earlier params have precidence.
  while ((match = /^(\/\:[^\/]+)\?/.exec(suffix))) {
    prefixes.push((prefix += match[1]));
    suffix = suffix.slice(match[0].length);
  }

  return expandOptionals(suffix).reduce<string[]>((results, expansion) => {
    results.push(...prefixes.map((p) => p + expansion));
    return results;
  }, []);
}
