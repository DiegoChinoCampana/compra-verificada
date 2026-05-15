package com.compraverificada.api.service;

import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Lectura Hot Sale en el resumen público: misma fila SQL que {@link HotSaleRoundupService}
 * (guía), condensada al JSON esperado por el front.
 */
@Service
public class HotSaleResumenSnapshotService {

    private static final Set<Integer> ALLOWED_DAYS = Set.of(10, 30, 60);

    private final HotSaleRoundupService hotSaleRoundupService;

    public HotSaleResumenSnapshotService(HotSaleRoundupService hotSaleRoundupService) {
        this.hotSaleRoundupService = hotSaleRoundupService;
    }

    /** Mismo shape JSON que el backend Node ({@code hotSaleResumen}). */
    public Map<String, Object> fetchOrNull(int articleId, Integer daysRaw) {
        if (daysRaw == null || !ALLOWED_DAYS.contains(daysRaw)) {
            return null;
        }
        int days = daysRaw;
        Map<String, Object> t = hotSaleRoundupService.fetchTrendRowForArticleOrNull(articleId, days);
        if (t == null) {
            return null;
        }

        Double lastRunMinAny = asDouble(t.get("market_last_min"));
        Double marketFirstMin = asDouble(t.get("market_first_min"));
        Double marketTrendPct = asDouble(t.get("market_trend_pct"));
        Double anchorFirstMin = asDouble(t.get("first_min"));
        Double anchorMaxInWindow = asDouble(t.get("w_max"));
        Object lastAt = t.get("market_last_at");
        if (lastRunMinAny == null || lastRunMinAny <= 0
                || marketFirstMin == null || marketFirstMin <= 0
                || marketTrendPct == null || !Double.isFinite(marketTrendPct)
                || anchorFirstMin == null || anchorFirstMin <= 0
                || anchorMaxInWindow == null || !Double.isFinite(anchorMaxInWindow)
                || lastAt == null) {
            return null;
        }

        String lastRunCheapestSeller = stringifyOrNull(t.get("market_last_cheapest_seller"));
        String anchorSeller = stringifyOrNull(t.get("trend_seller"));

        double eps = Math.max(0.01, anchorFirstMin * 0.002);
        boolean loweredEnough = lastRunMinAny < anchorFirstMin - eps;
        boolean otherStore = anchorSeller != null && lastRunCheapestSeller != null
                && !lastRunCheapestSeller.equals(anchorSeller);
        boolean otherStoreBeatAnchor = loweredEnough && otherStore;

        String lastRunIso;
        if (lastAt instanceof Timestamp ts) {
            lastRunIso = ts.toInstant().toString();
        } else {
            lastRunIso = Instant.parse(String.valueOf(lastAt)).toString();
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("days", days);
        out.put("lastRunAt", lastRunIso);
        out.put("lastRunMinAny", lastRunMinAny);
        out.put("marketFirstMin", marketFirstMin);
        out.put("marketTrendPct", marketTrendPct);
        out.put("lastRunCheapestSeller", lastRunCheapestSeller);
        out.put("anchorSeller", anchorSeller);
        out.put("anchorFirstMin", anchorFirstMin);
        out.put("anchorMaxInWindow", anchorMaxInWindow);
        out.put("otherStoreBeatAnchor", otherStoreBeatAnchor);
        return out;
    }

    private static String stringifyOrNull(Object v) {
        if (v == null) {
            return null;
        }
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? null : s;
    }

    private static Double asDouble(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
