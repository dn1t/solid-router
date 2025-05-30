import { $TRACK, createMemo, createSignal, getOwner, type JSX, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { useRouter } from "../routing.ts";
import type {
  NarrowResponse,
  Navigator,
  RouterContext,
  Submission,
  SubmissionStub,
} from "../types.ts";
import { mockBase } from "../utils.ts";
import { cacheKeyOp, hashKey, query, revalidate } from "./query.ts";

export type Action<T extends Array<any>, U, V = T> = (T extends [FormData] | []
  ? JSX.SerializableAttributeValue
  : unknown) &
  ((...vars: T) => Promise<NarrowResponse<U>>) & {
    url: string;
    with<A extends any[], B extends any[]>(
      this: (this: any, ...args: [...A, ...B]) => Promise<NarrowResponse<U>>,
      ...args: A
    ): Action<B, U, V>;
  };

export const actions = /* #__PURE__ */ new Map<string, Action<any, any>>();

export function useSubmissions<T extends Array<any>, U, V>(
  fn: Action<T, U, V>,
  filter?: (input: V) => boolean,
): Submission<T, NarrowResponse<U>>[] & { pending: boolean } {
  const router = useRouter();
  const subs = createMemo(() =>
    router.submissions[0]().filter(
      (s) => s.url === (fn as any).base && (!filter || filter(s.input)),
    ),
  );
  return new Proxy<Submission<any, any>[] & { pending: boolean }>([] as any, {
    get(_, property) {
      if (property === $TRACK) return subs();
      if (property === "pending") return subs().some((sub) => !sub.result);
      return subs()[property as any];
    },
    has(_, property) {
      return property in subs();
    },
  });
}

export function useSubmission<T extends Array<any>, U, V>(
  fn: Action<T, U, V>,
  filter?: (input: V) => boolean,
): Submission<T, NarrowResponse<U>> | SubmissionStub {
  const submissions = useSubmissions(fn, filter);
  return new Proxy(
    {},
    {
      get(_, property) {
        if ((submissions.length === 0 && property === "clear") || property === "retry")
          return () => {};
        return submissions[submissions.length - 1]?.[property as keyof Submission<T, U>];
      },
    },
  ) as Submission<T, NarrowResponse<U>>;
}

export function useAction<T extends Array<any>, U, V>(action: Action<T, U, V>) {
  const r = useRouter();
  return (...args: Parameters<Action<T, U, V>>) => action.apply({ r }, args);
}

export function action<T extends Array<any>, U = void>(
  fn: (...args: T) => Promise<U>,
  name?: string,
): Action<T, U>;
export function action<T extends Array<any>, U = void>(
  fn: (...args: T) => Promise<U>,
  options?: { name?: string; onComplete?: (s: Submission<T, U>) => void },
): Action<T, U>;
export function action<T extends Array<any>, U = void>(
  fn: (...args: T) => Promise<U>,
  options: string | { name?: string; onComplete?: (s: Submission<T, U>) => void } = {},
): Action<T, U> {
  function mutate(this: { r: RouterContext; f?: HTMLFormElement }, ...variables: T) {
    const router = this.r;
    const form = this.f;
    const p = (
      router.singleFlight && (fn as any).withOptions
        ? (fn as any).withOptions({ headers: { "X-Single-Flight": "true" } })
        : fn
    )(...variables);
    const [result, setResult] = createSignal<{ data?: U; error?: any }>();
    let submission: Submission<T, U>;
    function handler(error?: boolean) {
      return async (res: any) => {
        const result = await handleResponse(res, error, router.navigatorFactory());
        let retry = null;
        o.onComplete?.({
          ...submission,
          result: result?.data,
          error: result?.error,
          pending: false,
          retry() {
            return (retry = submission.retry());
          },
        });
        if (retry) return retry;
        if (!result) return submission.clear();
        setResult(result);
        if (result.error && !form) throw result.error;
        return result.data;
      };
    }
    router.submissions[1]((s) => [
      ...s,
      (submission = {
        input: variables,
        url,
        get result() {
          return result()?.data;
        },
        get error() {
          return result()?.error;
        },
        get pending() {
          return !result();
        },
        clear() {
          router.submissions[1]((v) => v.filter((i) => i !== submission));
        },
        retry() {
          setResult(undefined);
          const p = fn(...variables);
          return p.then(handler(), handler(true));
        },
      }),
    ]);
    return p.then(handler(), handler(true));
  }
  const o = typeof options === "string" ? { name: options } : options;
  const url: string =
    (fn as any).url ||
    (o.name && `https://action/${o.name}`) ||
    (!isServer ? `https://action/${hashString(fn.toString())}` : "");
  mutate.base = url;
  return toAction(mutate, url);
}

// biome-ignore lint/complexity/noBannedTypes:
function toAction<T extends Array<any>, U, V = T>(fn: Function, url: string): Action<T, U, V> {
  fn.toString = () => {
    if (!url) throw new Error("Client Actions need explicit names if server rendered");
    return url;
  };
  (fn as any).with = function <A extends any[], B extends any[]>(
    this: (...args: [...A, ...B]) => Promise<U>,
    ...args: A
  ) {
    const newFn = function (this: RouterContext, ...passedArgs: B): U {
      return fn.call(this, ...args, ...passedArgs);
    };
    newFn.base = (fn as any).base;
    const uri = new URL(url, mockBase);
    uri.searchParams.set("args", hashKey(args));
    return toAction<B, U, V>(
      newFn as any,
      (uri.origin === "https://action" ? uri.origin : "") + uri.pathname + uri.search,
    );
  };
  (fn as any).url = url;
  if (!isServer) {
    actions.set(url, fn as Action<T, U, V>);
    getOwner() && onCleanup(() => actions.delete(url));
  }
  return fn as Action<T, U, V>;
}

const hashString = (s: string) =>
  s.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0);

async function handleResponse(response: unknown, error: boolean | undefined, navigate: Navigator) {
  let data: any;
  let custom: any;
  let keys: string[] | undefined;
  let flightKeys: string[] | undefined;
  if (response instanceof Response) {
    if (response.headers.has("X-Revalidate"))
      keys = response.headers.get("X-Revalidate")!.split(",");
    if ((response as any).customBody) {
      data = custom = await (response as any).customBody();
      if (response.headers.has("X-Single-Flight")) {
        data = data._$value;
        // biome-ignore lint/performance/noDelete:
        delete custom._$value;
        flightKeys = Object.keys(custom);
      }
    }
    if (response.headers.has("Location")) {
      const locationUrl = response.headers.get("Location") || "/";
      if (locationUrl.startsWith("http")) {
        window.location.href = locationUrl;
      } else {
        navigate(locationUrl);
      }
    }
  } else if (error) return { error: response };
  else data = response;
  // invalidate
  cacheKeyOp(keys, (entry) => (entry[0] = 0));
  // set cache
  for (const k of flightKeys ?? []) {
    query.set(k, custom[k]);
  }
  // trigger revalidation
  await revalidate(keys, false);
  return data != null ? { data } : undefined;
}
