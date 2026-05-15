package com.compraverificada.api.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Misma heurística que {@code server/src/hotSaleNarrative.ts}.
 */
public final class HotSaleNarrative {
    private static final double PCT_INFLATE_VS_LAST = 0.05;
    private static final double PCT_INFLATE_VS_FIRST = 0.03;
    private static final double PCT_BELOW_MEDIAN = 0.02;
    private static final double PCT_SHARP_DOD_DROP = 0.12;

    private HotSaleNarrative() {}

    public static Map<String, Object> build(
            double firstMin,
            double lastMin,
            double wMax,
            double wMedian,
            double maxDodDropPct,
            int nPoints,
            Double marketFirstMin,
            Double marketLastMin,
            Double marketTrendPct,
            boolean anchorFresh) {
        List<String> bullets = new ArrayList<>();
        Map<String, Object> flags = new LinkedHashMap<>();

        boolean inflatedAnchor = false;
        boolean lastBelowMedian = false;
        boolean lastAboveMedian = false;
        boolean sharpDrop = false;

        if (!anchorFresh) {
            if (marketLastMin != null
                    && marketFirstMin != null
                    && marketLastMin > 0
                    && marketFirstMin > 0) {
                bullets.add(
                        "Ninguna tienda del primer día (ni una alternativa con dato reciente, ni la del último relevamiento más barato) armó una serie por tienda coherente. Mostramos solo la lectura entre todas las tiendas.");
            }
            flags.put("possibleInflatedAnchor", false);
            flags.put("lastBelowWindowMedian", false);
            flags.put("lastAboveWindowMedian", false);
            flags.put("sharpDayDrop", false);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("bullets", bullets);
            out.put("flags", flags);
            return out;
        }

        if (!(wMax > 0) || !(wMedian > 0) || nPoints < 2) {
            flags.put("possibleInflatedAnchor", false);
            flags.put("lastBelowWindowMedian", false);
            flags.put("lastAboveWindowMedian", false);
            flags.put("sharpDayDrop", false);
            return Map.of(
                    "bullets", bullets,
                    "flags", flags);
        }

        boolean inflatedVsLast = wMax > lastMin * (1 + PCT_INFLATE_VS_LAST);
        boolean inflatedVsFirst = wMax > firstMin * (1 + PCT_INFLATE_VS_FIRST);
        if (inflatedVsLast && inflatedVsFirst) {
            inflatedAnchor = true;
            bullets.add(
                    "En la ventana hubo días con el mínimo bastante más alto que el último: puede ser volatilidad normal, pero también un patrón compatible con precios inflados o lista cara antes de una baja o promo.");
        } else if (inflatedVsLast && wMax > lastMin * 1.12) {
            inflatedAnchor = true;
            bullets.add(
                    "El techo del mínimo diario en la ventana estuvo claramente por encima del último valor: conviene no tomar solo el último precio como referencia del “precio de antes”.");
        }

        if (lastMin < wMedian * (1 - PCT_BELOW_MEDIAN)) {
            lastBelowMedian = true;
            bullets.add(
                    "El último mínimo quedó por debajo de la mediana de la ventana: en el rango que vimos, está en la zona más baja.");
        } else if (lastMin > wMedian * (1 + PCT_BELOW_MEDIAN)) {
            lastAboveMedian = true;
            bullets.add(
                    "El último mínimo está por encima de la mediana de la ventana: todavía no está en la parte barata del período relevado.");
        }

        if (maxDodDropPct >= PCT_SHARP_DOD_DROP) {
            sharpDrop = true;
            String p = String.format("%.0f", maxDodDropPct * 100);
            bullets.add(
                    "Entre dos días consecutivos con dato hubo una caída grande (hasta ~" + p
                            + " % entre un día y el siguiente): puede ser promo, cambio de publicaciones o ruido; conviene mirar el listado.");
        }

        if (marketLastMin != null
                && marketFirstMin != null
                && marketLastMin > 0
                && marketFirstMin > 0
                && lastMin > 0) {
            if (marketLastMin < lastMin * (1 - PCT_BELOW_MEDIAN)) {
                String fmtMl = String.format("%,.0f", marketLastMin);
                String fmtL = String.format("%,.0f", lastMin);
                bullets.add(
                        "Entre todas las tiendas del mismo producto, el mejor precio al último relevamiento (" + fmtMl
                                + ") fue más bajo que el de la tienda que seguimos día a día (" + fmtL
                                + "): puede haber mejores ofertas en otras publicaciones.");
            }
            if (marketTrendPct != null && firstMin > 0) {
                double anchorTrend = (lastMin - firstMin) / firstMin;
                if (marketTrendPct < anchorTrend - 0.03 && marketTrendPct < -0.02) {
                    bullets.add(
                            "El mínimo entre todas las tiendas cayó más en el período que el de la tienda del primer día: conviene revisar el listado completo, no solo el vendedor que arrancó más barato.");
                }
            }
        }

        flags.put("possibleInflatedAnchor", inflatedAnchor);
        flags.put("lastBelowWindowMedian", lastBelowMedian);
        flags.put("lastAboveWindowMedian", lastAboveMedian);
        flags.put("sharpDayDrop", sharpDrop);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("bullets", bullets);
        out.put("flags", flags);
        return out;
    }

    /** Compat: sin serie mercado (no debería usarse si el SQL trae columnas market_*). */
    public static Map<String, Object> build(
            double firstMin,
            double lastMin,
            double wMax,
            double wMedian,
            double maxDodDropPct,
            int nPoints) {
        return build(firstMin, lastMin, wMax, wMedian, maxDodDropPct, nPoints, null, null, null, true);
    }

    /** Compat API: ancla tratada como vigente. */
    public static Map<String, Object> build(
            double firstMin,
            double lastMin,
            double wMax,
            double wMedian,
            double maxDodDropPct,
            int nPoints,
            Double marketFirstMin,
            Double marketLastMin,
            Double marketTrendPct) {
        return build(
                firstMin,
                lastMin,
                wMax,
                wMedian,
                maxDodDropPct,
                nPoints,
                marketFirstMin,
                marketLastMin,
                marketTrendPct,
                true);
    }
}
