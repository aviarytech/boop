/** Schedule long-lived sessions without overflowing the browser timer limit. */
export function onSessionExpiry(expiresAt: number, expire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const check = () => {
    const remaining = expiresAt - Date.now();
    if (remaining > 0) timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    else expire();
  };
  check();
  return () => clearTimeout(timer);
}
