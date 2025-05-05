/**
 * This is mock of the eventual Solid 2.0 primitive. It is not fully featured.
 */
import { type Accessor, createResource, type Setter, sharedConfig, untrack } from "solid-js";
import { createStore, reconcile, type ReconcileOptions, unwrap } from "solid-js/store";
import { isServer } from "solid-js/web";

/**
 * As `createAsync` and `createAsyncStore` are wrappers for `createResource`,
 * this type allows to support `latest` field for these primitives.
 * It will be removed in the future.
 */
export type AccessorWithLatest<T> = {
  (): T;
  latest: T;
};

export function createAsync<T>(
  fn: (prev: T) => Promise<T>,
  options: {
    name?: string;
    initialValue: T;
    deferStream?: boolean;
  },
): AccessorWithLatest<T>;
export function createAsync<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options?: {
    name?: string;
    initialValue?: T;
    deferStream?: boolean;
  },
): AccessorWithLatest<T | undefined>;
export function createAsync<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options?: {
    name?: string;
    initialValue?: T;
    deferStream?: boolean;
  },
): AccessorWithLatest<T | undefined> {
  // biome-ignore lint/style/useConst:
  let resource: () => T;
  const prev = () =>
    !resource || (resource as any).state === "unresolved" ? undefined : (resource as any).latest;
  [resource] = createResource(
    () => subFetch(fn, untrack(prev)),
    (v) => v,
    options as any,
  );

  const resultAccessor: AccessorWithLatest<T> = (() => resource()) as any;
  Object.defineProperty(resultAccessor, "latest", {
    get() {
      return (resource as any).latest;
    },
  });

  return resultAccessor;
}

export function createAsyncStore<T>(
  fn: (prev: T) => Promise<T>,
  options: {
    name?: string;
    initialValue: T;
    deferStream?: boolean;
    reconcile?: ReconcileOptions;
  },
): AccessorWithLatest<T>;
export function createAsyncStore<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options?: {
    name?: string;
    initialValue?: T;
    deferStream?: boolean;
    reconcile?: ReconcileOptions;
  },
): AccessorWithLatest<T | undefined>;
export function createAsyncStore<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options: {
    name?: string;
    initialValue?: T;
    deferStream?: boolean;
    reconcile?: ReconcileOptions;
  } = {},
): AccessorWithLatest<T | undefined> {
  // biome-ignore lint/style/useConst:
  let resource: () => T;
  const prev = () =>
    !resource || (resource as any).state === "unresolved"
      ? undefined
      : unwrap((resource as any).latest);
  [resource] = createResource(
    () => subFetch(fn, untrack(prev)),
    (v) => v,
    {
      ...options,
      storage: (init: T | undefined) => createDeepSignal(init, options.reconcile),
    } as any,
  );

  const resultAccessor: AccessorWithLatest<T> = (() => resource()) as any;
  Object.defineProperty(resultAccessor, "latest", {
    get() {
      return (resource as any).latest;
    },
  });

  return resultAccessor;
}

function createDeepSignal<T>(value: T | undefined, options?: ReconcileOptions) {
  const [store, setStore] = createStore({
    value: structuredClone(value),
  });
  return [
    () => store.value,
    (v: T) => {
      // biome-ignore lint/style/noParameterAssign:
      typeof v === "function" && (v = v());
      setStore("value", reconcile(structuredClone(v), options));
      return store.value;
    },
  ] as [Accessor<T | null>, Setter<T | null>];
}

// mock promise while hydrating to prevent fetching
class MockPromise {
  static all() {
    return new MockPromise();
  }
  static allSettled() {
    return new MockPromise();
  }
  static any() {
    return new MockPromise();
  }
  static race() {
    return new MockPromise();
  }
  static reject() {
    return new MockPromise();
  }
  static resolve() {
    return new MockPromise();
  }
  catch() {
    return new MockPromise();
  }
  // biome-ignore lint/suspicious/noThenProperty:
  then() {
    return new MockPromise();
  }
  finally() {
    return new MockPromise();
  }
}

function subFetch<T>(fn: (prev: T | undefined) => Promise<T>, prev: T | undefined) {
  if (isServer || !sharedConfig.context) return fn(prev);
  const ogFetch = fetch;
  const ogPromise = Promise;
  try {
    window.fetch = () => new MockPromise() as any;
    // biome-ignore lint/suspicious/noGlobalAssign:
    Promise = MockPromise as any;
    return fn(prev);
  } finally {
    window.fetch = ogFetch;
    // biome-ignore lint/suspicious/noGlobalAssign:
    Promise = ogPromise;
  }
}
