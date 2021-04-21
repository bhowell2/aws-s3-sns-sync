/**
 * Allows for setting some optional properties (K) to non-optional
 * of the object (O).
 */
export type RequireSome<O, K extends keyof O> = Omit<O, K> & {
  [P in K]-?: O[P]
};

/**
 * Makes some keys (K) of the object (O) optional.
 */
export type OptionalSome<O, K extends keyof O> = Omit<O, K> & {
  [P in K]?: O[P]
}

/**
 * Retrieves only the keys of a certain type (O) from the object (O).
 */
export type KeysOfType<O, T> = {
  [K in keyof O]: O[K] extends T ? K : never
}[keyof O];

/**
 * Maps the supplied key (K) to another key (N) for the object (O).
 */
export type MapKey<O, K extends keyof O, N extends string> = Omit<O, K> & {
  [P in N]: O[K]
}
