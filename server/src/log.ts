export function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}
