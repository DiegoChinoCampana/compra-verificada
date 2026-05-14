package com.compraverificada.api.service;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Igual que {@code server/src/jobs/productVariantKey.ts}: medidas explícitas en el título
 * (2D/3D, ml/L, cm³, pulgadas) para no fusionar listados solo por embedding cercano.
 */
public final class ProductVariantKey {

    private static final Pattern RE3 =
            Pattern.compile("(\\d{1,4})\\s*x\\s*(\\d{1,4})\\s*x\\s*(\\d{1,4})");
    private static final Pattern RE2 = Pattern.compile("(\\d{2,4})\\s*x\\s*(\\d{2,4})");
    private static final Pattern RE_ML = Pattern.compile("(\\d+(?:[.,]\\d+)?)\\s*ml\\b");
    private static final Pattern RE_L =
            Pattern.compile("(\\d+(?:[.,]\\d+)?)\\s+litros?\\b|(\\d+(?:[.,]\\d+)?)\\s+l\\b");
    private static final Pattern RE_CM_SUP =
            Pattern.compile("(\\d+(?:[.,]\\d+)?)\\s*cm\\s*[\\u00B33]\\b");
    private static final Pattern RE_CM3_LIT = Pattern.compile("(\\d+(?:[.,]\\d+)?)\\s*cm3\\b");
    private static final Pattern RE_IN =
            Pattern.compile("(\\d{2,3})\\s*(?:\"|''|pulg(?:adas)?)\\b");

    private ProductVariantKey() {}

    public static String fromTitle(String title) {
        if (title == null || title.isBlank()) {
            return null;
        }
        String t = Normalizer.normalize(title.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .replace('×', 'x');

        List<int[]> spans = new ArrayList<>();
        Set<String> tokens = new TreeSet<>();

        Matcher m3 = RE3.matcher(t);
        while (m3.find()) {
            tokens.add("d:" + stripLeadingZeros(m3.group(1))
                    + "x" + stripLeadingZeros(m3.group(2))
                    + "x" + stripLeadingZeros(m3.group(3)));
            addSpan(spans, m3.start(), m3.end());
        }

        Matcher m2 = RE2.matcher(t);
        while (m2.find()) {
            if (overlaps(spans, m2.start(), m2.end())) {
                continue;
            }
            tokens.add("d:" + stripLeadingZeros(m2.group(1))
                    + "x" + stripLeadingZeros(m2.group(2)));
            addSpan(spans, m2.start(), m2.end());
        }

        Matcher mMl = RE_ML.matcher(t);
        while (mMl.find()) {
            double v = parseDecimal(mMl.group(1));
            if (!Double.isFinite(v)) {
                continue;
            }
            tokens.add("ml:" + Math.round(v));
            addSpan(spans, mMl.start(), mMl.end());
        }

        Matcher mL = RE_L.matcher(t);
        while (mL.find()) {
            if (overlaps(spans, mL.start(), mL.end())) {
                continue;
            }
            String raw = mL.group(1);
            if (raw == null) {
                raw = mL.group(2);
            }
            if (raw == null) {
                continue;
            }
            double v = parseDecimal(raw) * 1000d;
            if (!Double.isFinite(v)) {
                continue;
            }
            tokens.add("ml:" + Math.round(v));
            addSpan(spans, mL.start(), mL.end());
        }

        Matcher mCmS = RE_CM_SUP.matcher(t);
        while (mCmS.find()) {
            double v = parseDecimal(mCmS.group(1));
            if (!Double.isFinite(v)) {
                continue;
            }
            tokens.add("cm3:" + Math.round(v));
            addSpan(spans, mCmS.start(), mCmS.end());
        }

        Matcher mCm3 = RE_CM3_LIT.matcher(t);
        while (mCm3.find()) {
            if (overlaps(spans, mCm3.start(), mCm3.end())) {
                continue;
            }
            double v = parseDecimal(mCm3.group(1));
            if (!Double.isFinite(v)) {
                continue;
            }
            tokens.add("cm3:" + Math.round(v));
            addSpan(spans, mCm3.start(), mCm3.end());
        }

        Matcher mIn = RE_IN.matcher(t);
        while (mIn.find()) {
            tokens.add("in:" + stripLeadingZeros(mIn.group(1)));
            addSpan(spans, mIn.start(), mIn.end());
        }

        if (tokens.isEmpty()) {
            return null;
        }
        return String.join("|", tokens);
    }

    public static boolean shareCluster(String ka, String kb) {
        if (ka == null && kb == null) {
            return true;
        }
        if (ka == null || kb == null) {
            return false;
        }
        return ka.equals(kb);
    }

    private static void addSpan(List<int[]> spans, int s, int e) {
        spans.add(new int[] {s, e});
    }

    private static boolean overlaps(List<int[]> spans, int s, int e) {
        for (int[] sp : spans) {
            if (!(e <= sp[0] || s >= sp[1])) {
                return true;
            }
        }
        return false;
    }

    private static double parseDecimal(String s) {
        return Double.parseDouble(s.replace(',', '.'));
    }

    private static String stripLeadingZeros(String s) {
        String t = s.replaceFirst("^0+(?!$)", "");
        return t.isEmpty() ? "0" : t;
    }

    static boolean canMergeClusterPair(int[] labels, String[] variantKeys, int c1, int c2) {
        Set<String> a = distinctNonNullKeys(labels, variantKeys, c1);
        Set<String> b = distinctNonNullKeys(labels, variantKeys, c2);
        if (a.isEmpty() && b.isEmpty()) {
            return true;
        }
        if (a.isEmpty() || b.isEmpty()) {
            return false;
        }
        if (a.size() > 1 || b.size() > 1) {
            return false;
        }
        return a.iterator().next().equals(b.iterator().next());
    }

    private static Set<String> distinctNonNullKeys(int[] labels, String[] variantKeys, int clusterId) {
        Set<String> s = new HashSet<>();
        for (int i = 0; i < labels.length; i++) {
            if (labels[i] != clusterId) {
                continue;
            }
            String k = variantKeys[i];
            if (k != null) {
                s.add(k);
            }
        }
        return s;
    }
}
