/**
 * Clave de variante solo para clustering: separa listados con embedding similar pero
 * medidas distintas **en el título** (cualquier rubro: colchones, TVs, líquidos, cajas…).
 *
 * Varias señales se normalizan, ordenan y unen con `|`. No modifica embeddings.
 */

type Span = { s: number; e: number };

function stripNumPart(s: string): string {
  const t = s.replace(/^0+(?!$)/, "");
  return t === "" ? "0" : t;
}

function overlaps(spans: Span[], s: number, e: number): boolean {
  return spans.some((sp) => !(e <= sp.s || s >= sp.e));
}

function addSpan(spans: Span[], s: number, e: number): void {
  spans.push({ s, e });
}

function parseDecimal(s: string): number {
  return Number.parseFloat(s.replace(",", "."));
}

/**
 * Construye clave estable a partir de medidas explícitas en el título.
 * Sin ninguna señal reconocida → `null` (esa fila se clusteriza solo por embedding).
 */
export function productVariantKeyFromTitle(title: string | null | undefined): string | null {
  if (!title || !title.trim()) return null;
  const t = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/×/g, "x");

  const spans: Span[] = [];
  const tokens = new Set<string>();

  // 3D: 10x20x30 (prioritario; evita tomar 20x30 como 2D suelto)
  const re3 = /(\d{1,4})\s*x\s*(\d{1,4})\s*x\s*(\d{1,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re3.exec(t)) !== null) {
    const s = m.index;
    const e = m.index + m[0].length;
    tokens.add(`d:${stripNumPart(m[1]!)}x${stripNumPart(m[2]!)}x${stripNumPart(m[3]!)}`);
    addSpan(spans, s, e);
  }

  // 2D: 160x200 (ambos lados ≥2 dígitos)
  const re2 = /(\d{2,4})\s*x\s*(\d{2,4})/g;
  while ((m = re2.exec(t)) !== null) {
    const s = m.index;
    const e = m.index + m[0].length;
    if (overlaps(spans, s, e)) continue;
    tokens.add(`d:${stripNumPart(m[1]!)}x${stripNumPart(m[2]!)}`);
    addSpan(spans, s, e);
  }

  // Mililitros
  const reMl = /(\d+(?:[.,]\d+)?)\s*ml\b/g;
  while ((m = reMl.exec(t)) !== null) {
    const v = parseDecimal(m[1]!);
    if (!Number.isFinite(v)) continue;
    tokens.add(`ml:${Math.round(v)}`);
    addSpan(spans, m.index, m.index + m[0].length);
  }

  // Litros → ml (espacio antes de “l” o “litro(s)” para no tomar la “l” de “ml”)
  const reL =
    /(\d+(?:[.,]\d+)?)\s+litros?\b|(\d+(?:[.,]\d+)?)\s+l\b/g;
  while ((m = reL.exec(t)) !== null) {
    const s = m.index;
    const e = m.index + m[0].length;
    if (overlaps(spans, s, e)) continue;
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const v = parseDecimal(raw) * 1000;
    if (!Number.isFinite(v)) continue;
    tokens.add(`ml:${Math.round(v)}`);
    addSpan(spans, s, e);
  }

  // cm con superíndice 3
  const reCmSup = /(\d+(?:[.,]\d+)?)\s*cm\s*[³3]\b/g;
  while ((m = reCmSup.exec(t)) !== null) {
    const v = parseDecimal(m[1]!);
    if (!Number.isFinite(v)) continue;
    tokens.add(`cm3:${Math.round(v)}`);
    addSpan(spans, m.index, m.index + m[0].length);
  }

  // cm3 literal
  const reCm3lit = /(\d+(?:[.,]\d+)?)\s*cm3\b/g;
  while ((m = reCm3lit.exec(t)) !== null) {
    const s = m.index;
    const e = m.index + m[0].length;
    if (overlaps(spans, s, e)) continue;
    const v = parseDecimal(m[1]!);
    if (!Number.isFinite(v)) continue;
    tokens.add(`cm3:${Math.round(v)}`);
    addSpan(spans, s, e);
  }

  // Pulgadas
  const reIn = /(\d{2,3})\s*(?:"|''|pulg(?:adas)?)\b/g;
  while ((m = reIn.exec(t)) !== null) {
    tokens.add(`in:${stripNumPart(m[1]!)}`);
    addSpan(spans, m.index, m.index + m[0].length);
  }

  if (tokens.size === 0) return null;
  return [...tokens].sort().join("|");
}

/** Si ambos tienen clave, deben ser idénticas. Si falta una, no se emparejan (estricto). */
export function variantKeysShareCluster(ka: string | null, kb: string | null): boolean {
  if (ka === null && kb === null) return true;
  if (ka === null || kb === null) return false;
  return ka === kb;
}
