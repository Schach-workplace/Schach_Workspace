/** Raw expiry is a scoped handle failure, never proof of lost session/company
 * authority. All other denials keep the existing global retirement contract. */
export function isIntelligenceRawExpiry(
  path: string,
  method: string,
  status: number,
  code: string,
): boolean {
  return (
    method === "GET" &&
    status === 403 &&
    code === "expired" &&
    /^\/companies\/[^/?]+\/intelligence\/jobs\/[^/?]+$/.test(path)
  );
}
