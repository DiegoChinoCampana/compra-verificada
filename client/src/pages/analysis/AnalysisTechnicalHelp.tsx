import type { ReactNode } from "react";

type Props = { children: ReactNode };

/** Bloque desplegable común en pantallas de Análisis. */
export function AnalysisTechnicalHelp({ children }: Props) {
  return (
    <details className="card block analysis-tech-help">
      <summary className="analysis-tech-help__summary">Ayuda técnica</summary>
      <div className="muted small analysis-tech-help__body">{children}</div>
    </details>
  );
}
