/**
 * SecureHandle — wraps a secret so it only exists inside the `use` closure
 * (SPEC §3.7, §4.2).
 *
 * The key is held in a native private field (`#key`): it is not enumerable,
 * not serializable, and unreachable from outside the instance — no property
 * access, no `Object.keys`, no `JSON.stringify` can leak it. The ONLY way to
 * obtain the key is to pass it into the `use` callback. Callers should keep
 * the handle (and the `use` body) in the narrowest possible scope.
 */
export class SecureHandle {
  #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  /**
   * Run `fn` with the secret. The key argument is visible only inside `fn`;
   * `fn`'s return value propagates unchanged (generic `T`).
   */
  use<T>(fn: (key: string) => T): T {
    return fn(this.#key);
  }
}
