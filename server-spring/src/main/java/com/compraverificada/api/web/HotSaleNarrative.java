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
            int nPoints) {
        List<String> bullets = new ArrayList<>();
        Map<String, Object> flags = new LinkedHashMap<>();

        boolean inflatedAnchor = false;
        boolean lastBelowMedian = false;
        boolean lastAboveMedian = false;
        boolean sharpDrop = false;

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

        flags.put("possibleInflatedAnchor", inflatedAnchor);
        flags.put("lastBelowWindowMedian", lastBelowMedian);
        flags.put("lastAboveWindowMedian", lastAboveMedian);
        flags.put("sharpDayDrop", sharpDrop);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("bullets", bullets);
        out.put("flags", flags);
        return out;
    }
}
