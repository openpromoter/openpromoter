/** EU VAT number check through the European Commission VIES REST API. Null = service unavailable. */
export async function checkVat(vatId: string): Promise<{ valid: boolean | null; checkedAt: Date }> {
  const clean = vatId.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cc = clean.slice(0, 2) === "EL" ? "EL" : clean.slice(0, 2);
  const num = clean.slice(2);
  try {
    const res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${num}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { valid: null, checkedAt: new Date() };
    const body = (await res.json()) as { isValid?: boolean; userError?: string };
    // MS_UNAVAILABLE / TIMEOUT mean "try later", not "invalid"
    if (body.userError && body.userError !== "VALID" && body.userError !== "INVALID")
      return { valid: null, checkedAt: new Date() };
    return { valid: !!body.isValid, checkedAt: new Date() };
  } catch {
    return { valid: null, checkedAt: new Date() };
  }
}
