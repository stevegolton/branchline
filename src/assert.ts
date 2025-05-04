export function assertDefined<T>(
  x: T,
  msg?: string,
): asserts x is NonNullable<T> {
  if (!x) {
    throw new Error(msg ?? "Expected value to be defined");
  }
}
