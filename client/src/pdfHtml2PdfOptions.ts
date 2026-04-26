/**
 * Opciones para html2pdf().set(). El paquete soporta `pagebreak` en runtime
 * (README) pero `type.d.ts` no lo declara.
 */
export type Html2PdfSetOptions = {
  margin?: number | [number, number] | [number, number, number, number];
  filename?: string;
  image?: {
    type?: "jpeg" | "png" | "webp";
    quality?: number;
  };
  enableLinks?: boolean;
  html2canvas?: object;
  jsPDF?: {
    unit?: string;
    format?: string | [number, number];
    orientation?: "portrait" | "landscape";
  };
  /** Pasá `{ mode: [] }` para desactivar el plugin de saltos (evita glitches con el clon). */
  pagebreak?: {
    mode?: string | string[];
    before?: string | string[];
    after?: string | string[];
    avoid?: string | string[];
  };
};

/** Casteo al parámetro de `.set()` (los tipos upstream omiten `pagebreak`). */
export function asHtml2PdfOptions(o: Html2PdfSetOptions) {
  return o as never;
}
