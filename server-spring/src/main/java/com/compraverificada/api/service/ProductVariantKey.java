package com.compraverificada.api.service;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Igual que {@code server/src/jobs/productVariantKey.ts}: separa listados por medida explícita en el
 * título (p. ej. 160x200 vs 200x200) para no fusionarlos por embedding cercano.
 */
public final class ProductVariantKey {

    private static final Pattern DIM =
            Pattern.compile("(\\d{2,4})\\s*[xX×]\\s*(\\d{2,4})");

    private ProductVariantKey() {}

    public static String fromTitle(String title) {
        if (title == null || title.isBlank()) {
            return null;
        }
        String t = Normalizer.normalize(title.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .replace('×', 'x');
        Matcher m = DIM.matcher(t);
        if (!m.find()) {
            return null;
        }
        String a = stripLeadingZeros(m.group(1));
        String b = stripLeadingZeros(m.group(2));
        return a + "x" + b;
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
