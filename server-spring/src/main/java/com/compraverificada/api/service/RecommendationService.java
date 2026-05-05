package com.compraverificada.api.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Equivalente a {@code server/src/recommendation.ts}: heurística de recomendación
 * (no es asesoramiento financiero). Misma fórmula y misma estructura JSON.
 */
@Service
public class RecommendationService {

    public static class Input {
        public final int peerRankIndex;
        public final int peerCount;
        public final Double runToRunTrendPct; // null si no aplica
        public final Double lastRunCv;        // null si no aplica

        public Input(int peerRankIndex, int peerCount, Double runToRunTrendPct, Double lastRunCv) {
            this.peerRankIndex = peerRankIndex;
            this.peerCount = peerCount;
            this.runToRunTrendPct = runToRunTrendPct;
            this.lastRunCv = lastRunCv;
        }
    }

    public Map<String, Object> build(Input input) {
        List<Map<String, Object>> factors = new ArrayList<>();
        int score = 50;

        int n = Math.max(1, input.peerCount);
        double rankPct = input.peerRankIndex / Math.max(1.0, (double) (n - 1 == 0 ? 1 : n - 1));
        double peerPosition = n <= 1 ? 0.5 : (Double.isFinite(rankPct) ? rankPct : 0.5);

        if (n > 1) {
            if (peerPosition <= 0.25) {
                score += 22;
                factors.add(factor("Comparación de marcas", "up",
                        "Entre artículos equivalentes (mismo nombre y detalle), el precio observado está entre los más bajos."));
            } else if (peerPosition >= 0.75) {
                score -= 22;
                factors.add(factor("Comparación de marcas", "down",
                        "Respecto a otras marcas con el mismo artículo y detalle, el precio observado está entre los más altos."));
            } else {
                factors.add(factor("Comparación de marcas", "flat",
                        "Posición intermedia frente a otras marcas equivalentes."));
            }
        } else {
            factors.add(factor("Comparación de marcas", "flat",
                    "No hay otras marcas registradas con el mismo artículo y detalle para comparar."));
        }

        Double trend = input.runToRunTrendPct;
        if (trend != null && Double.isFinite(trend)) {
            if (trend < -0.02) {
                score += 12;
                factors.add(factor("Tendencia entre corridas", "up",
                        "El mínimo por corrida bajó ~" + pctText(Math.abs(trend))
                                + "% respecto a la corrida anterior."));
            } else if (trend > 0.03) {
                score -= 14;
                factors.add(factor("Tendencia entre corridas", "down",
                        "El mínimo por corrida subió ~" + pctText(trend)
                                + "% respecto a la corrida anterior."));
            } else {
                factors.add(factor("Tendencia entre corridas", "flat",
                        "Variación acotada entre la última corrida y la anterior."));
            }
        } else {
            factors.add(factor("Tendencia entre corridas", "flat",
                    "No hay suficientes corridas con precio para calcular tendencia."));
        }

        Double cv = input.lastRunCv;
        if (cv != null && Double.isFinite(cv)) {
            if (cv > 0.35) {
                score -= 12;
                factors.add(factor("Dispersión de publicaciones", "down",
                        "En la última corrida hay mucha dispersión entre publicaciones; conviene revisar condiciones (vendedor, envío, modelo)."));
            } else if (cv < 0.12) {
                score += 6;
                factors.add(factor("Dispersión de publicaciones", "up",
                        "En la última corrida los precios observados están relativamente alineados."));
            } else {
                factors.add(factor("Dispersión de publicaciones", "flat",
                        "Dispersión moderada entre publicaciones de la última corrida."));
            }
        } else {
            factors.add(factor("Dispersión de publicaciones", "flat",
                    "No hay datos suficientes en la última corrida para medir dispersión."));
        }

        score = Math.max(0, Math.min(100, Math.round((float) score)));

        String tone;
        String label;
        if (score >= 68) {
            tone = "positive";
            label = "Se observa un contexto favorable para evaluar la compra";
        } else if (score <= 38) {
            tone = "negative";
            label = "Se observa un contexto desfavorable: conviene esperar o comparar más";
        } else {
            tone = "neutral";
            label = "Situación mixta: conviene comparar publicaciones puntuales antes de decidir";
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("label", label);
        body.put("tone", tone);
        body.put("score", score);
        body.put("factors", factors);
        return body;
    }

    private static Map<String, Object> factor(String key, String impact, String detail) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("key", key);
        f.put("impact", impact);
        f.put("detail", detail);
        return f;
    }

    private static String pctText(double v) {
        return String.format(Locale.ROOT, "%.1f", v * 100);
    }
}
