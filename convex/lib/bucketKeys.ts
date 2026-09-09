/** Uploaded objects must be a direct child of the authorized resource prefix. */
export function isDirectChildKey(key: string, prefix: string): boolean {
  if (!key.startsWith(`${prefix}/`)) return false;
  const name = key.slice(prefix.length + 1);
  return name.length > 0 && name !== "." && name !== ".." && !/[\\/]/.test(name);
}
