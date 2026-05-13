/** Umbrales heurísticos — copiados en HotSaleRoundupController.java si usás Spring. */
const PCT_INFLATE_VS_LAST = 0.05;
const PCT_INFLATE_VS_FIRST = 0.03;
const PCT_BELOW_MEDIAN = 0.02;
const PCT_SHARP_DOD_DROP = 0.12;

export type HotSaleNarrative = {
  /** Frases cortas para mostrar en el informe (lenguaje cotidiano). */
  bullets: string[];
  flags: {
    possibleInflatedAnchor: boolean;
    lastBelowWindowMedian: boolean;
    lastAboveWindowMedian: boolean;
    sharpDayDrop: boolean;
  };
};

type Metrics = {
  first_min: number;
  last_min: number;
  w_max: number;
  w_median: number;
  max_dod_drop_pct: number;
  n_points: number;
};

export function buildHotSaleNarrative(m: Metrics): HotSaleNarrative {
  const bullets: string[] = [];
  const flags = {
    possibleInflatedAnchor: false,
    lastBelowWindowMedian: false,
    lastAboveWindowMedian: false,
    sharpDayDrop: false,
  };

  if (!(m.w_max > 0) || !(m.w_median > 0) || m.n_points < 2) {
    return { bullets, flags };
  }

  // 1) “Inflado” / ancla alta en la ventana
  const inflatedVsLast = m.w_max > m.last_min * (1 + PCT_INFLATE_VS_LAST);
  const inflatedVsFirst = m.w_max > m.first_min * (1 + PCT_INFLATE_VS_FIRST);
  if (inflatedVsLast && inflatedVsFirst) {
    flags.possibleInflatedAnchor = true;
    bullets.push(
      "En la ventana hubo días con el mínimo bastante más alto que el último: puede ser volatilidad normal, pero también un patrón compatible con precios inflados o lista cara antes de una baja o promo.",
    );
  } else if (inflatedVsLast && m.w_max > m.last_min * 1.12) {
    flags.possibleInflatedAnchor = true;
    bullets.push(
      "El techo del mínimo diario en la ventana estuvo claramente por encima del último valor: conviene no tomar solo el último precio como referencia del “precio de antes”.",
    );
  }

  // 2) vs mediana de mínimos diarios
  if (m.last_min < m.w_median * (1 - PCT_BELOW_MEDIAN)) {
    flags.lastBelowWindowMedian = true;
    bullets.push(
      "El último mínimo quedó por debajo de la mediana de la ventana: en el rango que vimos, está en la zona más baja.",
    );
  } else if (m.last_min > m.w_median * (1 + PCT_BELOW_MEDIAN)) {
    flags.lastAboveWindowMedian = true;
    bullets.push(
      "El último mínimo está por encima de la mediana de la ventana: todavía no está en la parte barata del período relevado.",
    );
  }

  // 3) Salto fuerte entre días consecutivos con dato
  if (m.max_dod_drop_pct >= PCT_SHARP_DOD_DROP) {
    flags.sharpDayDrop = true;
    const p = (m.max_dod_drop_pct * 100).toFixed(0);
    bullets.push(
      `Entre dos días consecutivos con dato hubo una caída grande (hasta ~${p} % entre un día y el siguiente): puede ser promo, cambio de publicaciones o ruido; conviene mirar el listado.`,
    );
  }

  return { bullets, flags };
}
