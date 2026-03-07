export async function computeIntegrity(code: string): Promise<string> {
    const bytes = new TextEncoder().encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const uint8 = new Uint8Array(hashBuffer);
    let bin = '';
    for (const b of uint8) bin += String.fromCharCode(b);
    return `sha256-${btoa(bin)}`;
}
