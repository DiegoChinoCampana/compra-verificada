package com.compraverificada.api.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Port directo de {@code server/src/jobs/productClusteringJob.ts}: embedding + DBSCAN +
 * fusiones (centroides, par máximo, anclaje por título).
 */
@Service
public class ProductClusteringJob {

    private static final Logger log = LoggerFactory.getLogger(ProductClusteringJob.class);

    private final JdbcTemplate jdbc;
    private final EmbeddingService embeddings;
    private final ClusterBatchMetaService meta;

    private final boolean defaultSkipCentroid;
    private final double defaultCentroidMinSim;
    private final boolean defaultSkipPairwise;
    private final boolean defaultSkipTitleAnchor;
    private final int defaultTitleAnchorMinLen;

    public ProductClusteringJob(
            JdbcTemplate jdbc,
            EmbeddingService embeddings,
            ClusterBatchMetaService meta,
            @Value("${cv.cluster-merge.skip-centroid:false}") boolean defaultSkipCentroid,
            @Value("${cv.cluster-merge.centroid-min-similarity:0.92}") double defaultCentroidMinSim,
            @Value("${cv.cluster-merge.skip-pairwise:false}") boolean defaultSkipPairwise,
            @Value("${cv.cluster-merge.skip-title-anchor:false}") boolean defaultSkipTitleAnchor,
            @Value("${cv.cluster-merge.title-anchor-min-len:10}") int defaultTitleAnchorMinLen) {
        this.jdbc = jdbc;
        this.embeddings = embeddings;
        this.meta = meta;
        this.defaultSkipCentroid = defaultSkipCentroid;
        this.defaultCentroidMinSim = clampSim(defaultCentroidMinSim, 0.92);
        this.defaultSkipPairwise = defaultSkipPairwise;
        this.defaultSkipTitleAnchor = defaultSkipTitleAnchor;
        this.defaultTitleAnchorMinLen = clampInt(defaultTitleAnchorMinLen, 10, 8, 24);
    }

    public static class Input {
        public String article;
        public Integer days;
        public Integer limit;
        public Integer batchSize;
        public Double minSimilarity;
        public Integer minPts;
        public Double centroidMergeMinSimilarity;
        public Boolean skipCentroidMerge;
        public Double pairwiseMergeMinSimilarity;
        public Boolean skipPairwiseMerge;
        public Integer titleAnchorMinLen;
        public Boolean skipTitleAnchorMerge;
        public Boolean embedOnly;
        public Boolean clusterOnly;
        public Boolean resetArticleWindow;
        public Boolean resetScope;
    }

    private static double clampSim(double v, double fallback) {
        if (!Double.isFinite(v) || v <= 0) return fallback;
        return Math.min(0.999, Math.max(0.5, v));
    }

    private static int clampInt(Integer v, int fallback, int min, int max) {
        if (v == null) return fallback;
        return Math.min(max, Math.max(min, v));
    }

    public Map<String, Object> run(Input raw) {
        if (raw == null || raw.article == null || raw.article.trim().length() < 2) {
            throw new IllegalArgumentException("article debe tener al menos 2 caracteres");
        }
        if (Boolean.TRUE.equals(raw.embedOnly) && Boolean.TRUE.equals(raw.clusterOnly)) {
            throw new IllegalArgumentException("No usar embedOnly y clusterOnly a la vez");
        }
        String article = raw.article.trim();
        int days = clampInt(raw.days, 60, 7, 120);
        int limit = clampInt(raw.limit, 8000, 100, 20_000);
        int batchSize = clampInt(raw.batchSize, 40, 1, 100);
        double minSimilarity = clampSim(raw.minSimilarity == null ? 0.9 : raw.minSimilarity, 0.9);
        int minPts = clampInt(raw.minPts, 2, 2, 20);

        boolean skipCentroidMerge = raw.skipCentroidMerge != null ? raw.skipCentroidMerge : defaultSkipCentroid;
        double centroidMergeMinSimilarity = raw.centroidMergeMinSimilarity != null
                ? clampSim(raw.centroidMergeMinSimilarity, defaultCentroidMinSim)
                : defaultCentroidMinSim;
        boolean skipPairwiseMerge = raw.skipPairwiseMerge != null ? raw.skipPairwiseMerge : defaultSkipPairwise;
        double pairwiseMergeMinSimilarity = raw.pairwiseMergeMinSimilarity != null
                ? clampSim(raw.pairwiseMergeMinSimilarity, centroidMergeMinSimilarity)
                : centroidMergeMinSimilarity;
        int titleAnchorMinLen = clampInt(raw.titleAnchorMinLen, defaultTitleAnchorMinLen, 8, 24);
        boolean skipTitleAnchorMerge = raw.skipTitleAnchorMerge != null ? raw.skipTitleAnchorMerge : defaultSkipTitleAnchor;

        boolean embedOnly = Boolean.TRUE.equals(raw.embedOnly);
        boolean clusterOnly = Boolean.TRUE.equals(raw.clusterOnly);
        boolean resetArticleWindow = Boolean.TRUE.equals(raw.resetArticleWindow);
        boolean resetScope = Boolean.TRUE.equals(raw.resetScope);

        long t0 = System.currentTimeMillis();
        int embedded = 0;
        ClusterStats stats = new ClusterStats(0, 0, 0);

        if (!clusterOnly) {
            embedded = runEmbed(article, days, limit, batchSize);
        }
        if (!embedOnly) {
            stats = runCluster(article, days, limit, minSimilarity, minPts, resetScope, resetArticleWindow,
                    skipCentroidMerge, centroidMergeMinSimilarity,
                    skipPairwiseMerge, pairwiseMergeMinSimilarity,
                    skipTitleAnchorMerge, titleAnchorMinLen);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("finishedAt", java.time.OffsetDateTime.now().toString());
        payload.put("article", article);
        payload.put("days", days);
        payload.put("embedded", embedded);
        payload.put("clusteredRows", stats.clusteredRows);
        payload.put("inCluster", stats.inCluster);
        payload.put("noise", stats.noise);
        payload.put("minSimilarity", minSimilarity);
        payload.put("minPts", minPts);
        payload.put("centroidMergeMinSimilarity", centroidMergeMinSimilarity);
        payload.put("skipCentroidMerge", skipCentroidMerge);
        payload.put("pairwiseMergeMinSimilarity", pairwiseMergeMinSimilarity);
        payload.put("skipPairwiseMerge", skipPairwiseMerge);
        payload.put("titleAnchorMinLen", titleAnchorMinLen);
        payload.put("skipTitleAnchorMerge", skipTitleAnchorMerge);
        payload.put("resetArticleWindow", resetArticleWindow);
        payload.put("resetScope", resetScope);
        payload.put("durationMs", System.currentTimeMillis() - t0);

        meta.write(payload);
        log.info("[batch] meta guardada en configs id=100.");
        return payload;
    }

    private int runEmbed(String article, int days, int limit, int batchSize) {
        List<EmbeddingService.TitleRow> missing = embeddings.fetchResultsMissingEmbeddings(article, days, limit);
        log.info("[embed] pendientes: {} (article ~ {}, {} días)", missing.size(), article, days);
        int done = 0;
        for (int i = 0; i < missing.size(); i += batchSize) {
            List<EmbeddingService.TitleRow> chunk = missing.subList(i, Math.min(missing.size(), i + batchSize));
            List<String> texts = new ArrayList<>(chunk.size());
            for (var r : chunk) texts.add(EmbeddingService.normalizeTitleForEmbedding(r.title()));
            List<double[]> vectors = embeddings.fetchBatch(texts);
            for (int k = 0; k < chunk.size(); k++) {
                embeddings.upsertResultEmbedding(chunk.get(k).id(), vectors.get(k));
            }
            done += chunk.size();
            log.info("[embed] guardados {} / {}", done, missing.size());
        }
        return done;
    }

    private record EmbeddedRow(int id, String embText, String title) {}

    private static final RowMapper<EmbeddedRow> EMBEDDED_ROW = (rs, n) ->
            new EmbeddedRow(rs.getInt("id"), rs.getString("emb_text"), rs.getString("title"));

    private record ClusterStats(int clusteredRows, int inCluster, int noise) {}

    private ClusterStats runCluster(
            String article, int days, int limit,
            double minSimilarity, int minPts,
            boolean resetScope, boolean resetArticleWindow,
            boolean skipCentroidMerge, double centroidMergeMinSimilarity,
            boolean skipPairwiseMerge, double pairwiseMergeMinSimilarity,
            boolean skipTitleAnchorMerge, int titleAnchorMinLen) {

        double eps = 1.0 - minSimilarity;
        String pattern = "%" + article + "%";

        if (resetArticleWindow) {
            int updated = jdbc.update(
                    "UPDATE results r "
                            + "SET product_key = NULL, product_cluster_id = NULL, product_confidence = NULL "
                            + "FROM scrape_runs sr, articles a "
                            + "WHERE r.scrape_run_id = sr.id AND r.search_id = a.id "
                            + "  AND a.enabled = TRUE AND a.article ILIKE ? "
                            + "  AND sr.executed_at >= NOW() - (CAST(? AS int) * interval '1 day')",
                    pattern, days);
            log.info("[cluster] reset amplio (artículo+ventana): {} filas sin product_key antes de reagrupar.", updated);
        }

        List<EmbeddedRow> rows = jdbc.query(
                "SELECT r.id, e.embedding::text AS emb_text, r.title "
                        + "FROM results r "
                        + "INNER JOIN result_embeddings e ON e.result_id = r.id "
                        + "INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id "
                        + "INNER JOIN articles a ON a.id = r.search_id "
                        + "WHERE a.enabled = TRUE "
                        + "  AND a.article ILIKE ? "
                        + "  AND sr.executed_at >= NOW() - (CAST(? AS int) * interval '1 day') "
                        + "ORDER BY r.id LIMIT ?",
                EMBEDDED_ROW, pattern, days, limit);

        if (rows.isEmpty()) {
            log.info("[cluster] sin filas con embedding en el universo; ejecutá embed o ampliá ventana.");
            return new ClusterStats(0, 0, 0);
        }

        List<double[]> points = new ArrayList<>(rows.size());
        List<Integer> ids = new ArrayList<>(rows.size());
        List<String> titles = new ArrayList<>(rows.size());
        for (EmbeddedRow row : rows) {
            double[] vec = parseVectorText(row.embText());
            if (vec.length == 0) {
                log.warn("[cluster] no se pudo parsear embedding para result_id={}, skip", row.id());
                continue;
            }
            points.add(vec);
            ids.add(row.id());
            titles.add(row.title());
        }
        if (points.size() < minPts) {
            log.info("[cluster] muy pocas filas ({}) < minPts={}, abort.", points.size(), minPts);
            return new ClusterStats(0, 0, 0);
        }

        if (resetScope) {
            jdbc.update(
                    "UPDATE results SET product_key = NULL, product_cluster_id = NULL, product_confidence = NULL "
                            + "WHERE id = ANY(?)",
                    (java.sql.PreparedStatement ps) -> {
                        java.sql.Connection c = ps.getConnection();
                        Integer[] arr = ids.toArray(new Integer[0]);
                        ps.setArray(1, c.createArrayOf("integer", arr));
                    });
            log.info("[cluster] reset de claves en {} filas a agrupar.", ids.size());
        }

        int[] labels = dbscanCosine(points, eps, minPts);
        if (!skipCentroidMerge) {
            labels = mergeClustersByCentroid(labels, points, centroidMergeMinSimilarity);
        }
        if (!skipPairwiseMerge) {
            labels = mergeClustersByMaxPairwiseSim(labels, points, pairwiseMergeMinSimilarity);
        }
        if (!skipTitleAnchorMerge) {
            labels = mergeClustersBySharedTitleAnchors(labels, titles, titleAnchorMinLen);
        }

        String slug = article.replaceAll("\\s+", "_");
        if (slug.length() > 40) slug = slug.substring(0, 40);
        applyClusterLabels(ids, labels, slug);

        int inCluster = 0;
        int noise = 0;
        for (int l : labels) {
            if (l >= 0) inCluster++;
            else if (l == -1) noise++;
        }
        log.info("[cluster] listo: {} filas, eps(dist)={} (sim≥{}), minPts={}, en_cluster={}, ruido={}",
                ids.size(), String.format(Locale.ROOT, "%.3f", eps), minSimilarity, minPts, inCluster, noise);
        return new ClusterStats(ids.size(), inCluster, noise);
    }

    @Transactional
    protected void applyClusterLabels(List<Integer> ids, int[] labels, String slug) {
        try {
            for (int i = 0; i < ids.size(); i++) {
                int id = ids.get(i);
                int lab = labels[i];
                if (lab < 0) {
                    jdbc.update(
                            "UPDATE results SET product_key = NULL, product_cluster_id = NULL, product_confidence = 0 WHERE id = ?",
                            id);
                } else {
                    String productKey = "cluster:" + slug + ":" + lab;
                    jdbc.update(
                            "UPDATE results SET product_key = ?, product_cluster_id = ?, product_confidence = ? WHERE id = ?",
                            productKey, lab, 1, id);
                }
            }
        } catch (DataAccessException e) {
            throw new RuntimeException("[cluster] fallo en transacción de update", e);
        }
    }

    // ---------- Vectores y DBSCAN ----------

    private static double[] parseVectorText(String raw) {
        if (raw == null) return new double[0];
        String s = raw.trim();
        if (s.startsWith("(") && s.endsWith(")")) {
            s = "[" + s.substring(1, s.length() - 1) + "]";
        }
        if (!s.startsWith("[") || !s.endsWith("]")) return new double[0];
        String inner = s.substring(1, s.length() - 1).trim();
        if (inner.isEmpty()) return new double[0];
        String[] parts = inner.split(",");
        double[] out = new double[parts.length];
        for (int i = 0; i < parts.length; i++) {
            try {
                out[i] = Double.parseDouble(parts[i].trim());
            } catch (NumberFormatException ex) {
                return new double[0];
            }
        }
        return out;
    }

    private static double cosineDistance(double[] a, double[] b) {
        double dot = 0, na = 0, nb = 0;
        int n = Math.min(a.length, b.length);
        for (int i = 0; i < n; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        double denom = Math.sqrt(na) * Math.sqrt(nb);
        if (denom <= 0) return 1.0;
        return 1.0 - dot / denom;
    }

    private static double cosineSimilarity(double[] a, double[] b) {
        return 1.0 - cosineDistance(a, b);
    }

    private static int[] dbscanCosine(List<double[]> points, double eps, int minPts) {
        final int UNDEF = -2, NOISE = -1;
        int n = points.size();
        int[] labels = new int[n];
        for (int i = 0; i < n; i++) labels[i] = UNDEF;

        int cluster = 0;
        for (int i = 0; i < n; i++) {
            if (labels[i] != UNDEF) continue;
            List<Integer> neigh = region(points, i, eps);
            if (neigh.size() + 1 < minPts) {
                labels[i] = NOISE;
                continue;
            }
            labels[i] = cluster;
            List<Integer> seeds = new ArrayList<>(neigh);
            while (!seeds.isEmpty()) {
                int q = seeds.remove(seeds.size() - 1);
                if (labels[q] == NOISE) labels[q] = cluster;
                if (labels[q] != UNDEF) continue;
                labels[q] = cluster;
                List<Integer> nq = region(points, q, eps);
                if (nq.size() + 1 >= minPts) {
                    for (int p : nq) {
                        if (labels[p] == UNDEF || labels[p] == NOISE) seeds.add(p);
                    }
                }
            }
            cluster += 1;
        }
        return labels;
    }

    private static List<Integer> region(List<double[]> points, int i, double eps) {
        List<Integer> out = new ArrayList<>();
        double[] base = points.get(i);
        for (int j = 0; j < points.size(); j++) {
            if (i == j) continue;
            if (cosineDistance(base, points.get(j)) <= eps) out.add(j);
        }
        return out;
    }

    private static int[] mergeClustersByCentroid(int[] labels, List<double[]> points, double mergeMinSim) {
        Set<Integer> ids = new HashSet<>();
        for (int l : labels) if (l >= 0) ids.add(l);
        if (ids.size() <= 1) return labels;
        List<Integer> sortedIds = new ArrayList<>(ids);
        Collections.sort(sortedIds);

        int dim = points.get(0).length;
        Map<Integer, double[]> centroids = new HashMap<>();
        for (int c : sortedIds) {
            double[] acc = new double[dim];
            int cnt = 0;
            for (int i = 0; i < labels.length; i++) {
                if (labels[i] != c) continue;
                cnt++;
                double[] p = points.get(i);
                for (int d = 0; d < dim; d++) acc[d] += p[d];
            }
            if (cnt > 0) for (int d = 0; d < dim; d++) acc[d] /= cnt;
            centroids.put(c, acc);
        }

        Map<Integer, Integer> parent = new HashMap<>();
        for (int c : sortedIds) parent.put(c, c);

        double mergeDistMax = 1.0 - mergeMinSim;
        for (int i = 0; i < sortedIds.size(); i++) {
            for (int j = i + 1; j < sortedIds.size(); j++) {
                int c1 = sortedIds.get(i), c2 = sortedIds.get(j);
                if (cosineDistance(centroids.get(c1), centroids.get(c2)) <= mergeDistMax) {
                    union(parent, c1, c2);
                }
            }
        }
        int[] out = relabel(labels, parent, sortedIds);
        if (sortedIds.size() != countRoots(parent, sortedIds)) {
            log.info("[cluster] fusión por centroides: {} → {} clusters (sim ≥ {})",
                    sortedIds.size(), countRoots(parent, sortedIds), mergeMinSim);
        }
        return out;
    }

    private static int[] mergeClustersByMaxPairwiseSim(int[] labels, List<double[]> points, double mergeMinSim) {
        Set<Integer> ids = new HashSet<>();
        for (int l : labels) if (l >= 0) ids.add(l);
        if (ids.size() <= 1) return labels;
        List<Integer> sortedIds = new ArrayList<>(ids);
        Collections.sort(sortedIds);

        Map<Integer, List<Integer>> byCluster = new HashMap<>();
        for (int c : sortedIds) byCluster.put(c, new ArrayList<>());
        for (int i = 0; i < labels.length; i++) {
            int L = labels[i];
            if (L < 0) continue;
            byCluster.get(L).add(i);
        }

        Map<Integer, Integer> parent = new HashMap<>();
        for (int c : sortedIds) parent.put(c, c);

        for (int i = 0; i < sortedIds.size(); i++) {
            for (int j = i + 1; j < sortedIds.size(); j++) {
                int c1 = sortedIds.get(i), c2 = sortedIds.get(j);
                List<Integer> idx1 = byCluster.get(c1);
                List<Integer> idx2 = byCluster.get(c2);
                double maxSim = -1;
                for (int ia : idx1) {
                    double[] pa = points.get(ia);
                    for (int ib : idx2) {
                        double s = cosineSimilarity(pa, points.get(ib));
                        if (s > maxSim) maxSim = s;
                    }
                }
                if (maxSim >= mergeMinSim) union(parent, c1, c2);
            }
        }
        int[] out = relabel(labels, parent, sortedIds);
        if (sortedIds.size() != countRoots(parent, sortedIds)) {
            log.info("[cluster] fusión por par máximo entre clusters: {} → {} (sim ≥ {})",
                    sortedIds.size(), countRoots(parent, sortedIds), mergeMinSim);
        }
        return out;
    }

    private static final Pattern ANCHOR_TOKEN = Pattern.compile("[A-Z0-9]+");

    private static int[] mergeClustersBySharedTitleAnchors(int[] labels, List<String> titles, int minTokenLen) {
        Set<Integer> ids = new HashSet<>();
        for (int l : labels) if (l >= 0) ids.add(l);
        if (ids.size() <= 1) return labels;
        List<Integer> sortedIds = new ArrayList<>(ids);
        Collections.sort(sortedIds);

        Map<String, Set<Integer>> tokenToClusters = new HashMap<>();
        for (int i = 0; i < labels.length; i++) {
            int L = labels[i];
            if (L < 0) continue;
            String t = titles.get(i);
            if (t == null) continue;
            String upper = t.toUpperCase(Locale.ROOT);
            Matcher m = ANCHOR_TOKEN.matcher(upper);
            Set<String> seen = new HashSet<>();
            while (m.find()) {
                String tok = m.group();
                if (tok.length() < minTokenLen) continue;
                if (!tok.matches(".*[0-9].*")) continue;
                seen.add(tok);
            }
            for (String tok : seen) {
                tokenToClusters.computeIfAbsent(tok, k -> new HashSet<>()).add(L);
            }
        }

        Map<Integer, Integer> parent = new HashMap<>();
        for (int c : sortedIds) parent.put(c, c);
        for (Set<Integer> set : tokenToClusters.values()) {
            if (set.size() < 2) continue;
            Integer first = null;
            for (int c : set) {
                if (first == null) first = c;
                else union(parent, first, c);
            }
        }
        int[] out = relabel(labels, parent, sortedIds);
        if (sortedIds.size() != countRoots(parent, sortedIds)) {
            log.info("[cluster] fusión por código en título (≥{} chars, con dígito): {} → {} clusters",
                    minTokenLen, sortedIds.size(), countRoots(parent, sortedIds));
        }
        return out;
    }

    private static int find(Map<Integer, Integer> parent, int x) {
        int p = parent.get(x);
        if (p != x) {
            int r = find(parent, p);
            parent.put(x, r);
            return r;
        }
        return p;
    }

    private static void union(Map<Integer, Integer> parent, int a, int b) {
        int ra = find(parent, a);
        int rb = find(parent, b);
        if (ra != rb) parent.put(ra, rb);
    }

    private static int[] relabel(int[] labels, Map<Integer, Integer> parent, List<Integer> sortedIds) {
        Set<Integer> roots = new HashSet<>();
        for (int c : sortedIds) roots.add(find(parent, c));
        List<Integer> sortedRoots = new ArrayList<>(roots);
        Collections.sort(sortedRoots);
        Map<Integer, Integer> rootToNew = new HashMap<>();
        for (int i = 0; i < sortedRoots.size(); i++) rootToNew.put(sortedRoots.get(i), i);
        int[] out = labels.clone();
        for (int i = 0; i < labels.length; i++) {
            int L = labels[i];
            if (L < 0) continue;
            out[i] = rootToNew.get(find(parent, L));
        }
        return out;
    }

    private static int countRoots(Map<Integer, Integer> parent, List<Integer> sortedIds) {
        Set<Integer> roots = new HashSet<>();
        for (int c : sortedIds) roots.add(find(parent, c));
        return roots.size();
    }
}
