/**
 * Alinea listados que comparten embedding “cercano” pero **distinta medida / tamaño**
 * declarada en el título (p. ej. colchón Queen 160×200 vs Super King 200×200).
 *
 * Se usa solo en el job de clustering; no altera embeddings ya guardados.
 */

const DIM_PATTERN = /(\d{2,4})\s*[x×X]\s*(\d{2,4})/;

/**
 * Extrae la primera medida `NxM` del título (orden como en la publicación).
 * Ej.: "Queen 160x200" → "160x200"; "200 X 200" → "200x200".
 */
export function productVariantKeyFromTitle(title: string | null | undefined): string | null {
  if (!title || !title.trim()) return null;
  const t = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/×/g, "x");
  const m = DIM_PATTERN.exec(t);
  if (!m) return null;
  const a = m[1]!.replace(/^0+/, "") || "0";
  const b = m[2]!.replace(/^0+/, "") || "0";
  return `${a}x${b}`;
}

/** Si ambos tienen clave, tienen que ser iguales. Si falta una clave, no se emparejan (estricto). */
export function variantKeysShareCluster(ka: string | null, kb: string | null): boolean {
  if (ka === null && kb === null) return true;
  if (ka === null || kb === null) return false;
  return ka === kb;
}
