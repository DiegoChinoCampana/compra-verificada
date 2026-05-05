package com.compraverificada.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.text.Normalizer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Equivalente a {@code server/src/services/embeddingService.ts}.
 * Llama OpenAI Embeddings, guarda vectores en {@code result_embeddings}.
 */
@Service
public class EmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingService.class);
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(20))
            .build();

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final String apiKey;
    private final String projectId;
    private final String baseUrl;
    private final String model;
    private final int dimensions;

    public EmbeddingService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            @Value("${cv.openai.api-key:}") String apiKey,
            @Value("${cv.openai.project-id:}") String projectId,
            @Value("${cv.openai.base-url:https://api.openai.com/v1}") String baseUrl,
            @Value("${cv.openai.embedding-model:text-embedding-3-small}") String model,
            @Value("${cv.openai.embedding-dimensions:1536}") int dimensions) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.projectId = projectId == null ? "" : projectId.trim();
        this.baseUrl = (baseUrl == null ? "https://api.openai.com/v1" : baseUrl).replaceAll("/+$", "");
        this.model = model;
        this.dimensions = dimensions > 0 ? dimensions : 1536;
    }

    public boolean isApiKeyConfigured() {
        return !apiKey.isEmpty();
    }

    public int getDimensions() {
        return dimensions;
    }

    /** Idéntica normalización que el server Node (texto que va al modelo de embeddings). */
    public static String normalizeTitleForEmbedding(String title) {
        if (title == null) return "";
        String s = title.toLowerCase(Locale.ROOT);
        s = Normalizer.normalize(s, Normalizer.Form.NFD);
        s = s.replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        s = s.replaceAll("(?i)(oferta|nuevo|envio gratis|envío gratis|cuotas)", "");
        s = s.replaceAll("\\s+", " ").trim();
        return s;
    }

    /** Pide vectores a OpenAI para un batch (preserva el orden). */
    public List<double[]> fetchBatch(List<String> inputs) {
        if (apiKey.isEmpty()) {
            throw new IllegalStateException(
                    "Falta OPENAI_API_KEY: configurarlo en variables de entorno del Tomcat (CATALINA_OPTS) o en application-tomcat.yml. " +
                    "Sin clave no se pueden generar embeddings. Si ya tenés embeddings en la base, probá el modo «Solo clustering».");
        }
        if (inputs.isEmpty()) return List.of();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("input", inputs);
        if (model != null && model.startsWith("text-embedding-3")) {
            body.put("dimensions", dimensions);
        }

        try {
            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/embeddings"))
                    .timeout(Duration.ofSeconds(60))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
            if (!projectId.isEmpty()) {
                reqBuilder.header("OpenAI-Project", projectId);
            }
            HttpResponse<String> res = HTTP.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode root = mapper.readTree(res.body());
            if (res.statusCode() < 200 || res.statusCode() >= 300) {
                String msg = root.path("error").path("message").asText("");
                throw new RuntimeException("[embedding] OpenAI HTTP " + res.statusCode() + ": " +
                        (msg.isEmpty() ? res.body() : msg));
            }
            JsonNode data = root.path("data");
            if (!data.isArray()) {
                throw new RuntimeException("[embedding] Respuesta sin 'data': " + res.body());
            }
            // Indexar por 'index' por si OpenAI los devuelve desordenados.
            double[][] sorted = new double[inputs.size()][];
            for (JsonNode entry : data) {
                int idx = entry.path("index").asInt(-1);
                if (idx < 0 || idx >= inputs.size()) {
                    throw new RuntimeException("[embedding] index inválido en respuesta: " + idx);
                }
                JsonNode vec = entry.path("embedding");
                if (!vec.isArray() || vec.size() != dimensions) {
                    throw new RuntimeException("[embedding] dimensión inesperada (esperado "
                            + dimensions + ", obtuve " + vec.size() + ")");
                }
                double[] arr = new double[dimensions];
                for (int i = 0; i < dimensions; i++) arr[i] = vec.get(i).asDouble();
                sorted[idx] = arr;
            }
            List<double[]> out = new ArrayList<>(inputs.size());
            for (int i = 0; i < inputs.size(); i++) {
                if (sorted[i] == null) {
                    throw new RuntimeException("[embedding] respuesta incompleta para index " + i);
                }
                out.add(sorted[i]);
            }
            return out;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("[embedding] error llamando a OpenAI: " + e.getMessage(), e);
        }
    }

    /** Serializa un vector como literal compatible con pgvector. */
    public static String vectorLiteral(double[] embedding) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < embedding.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(String.format(Locale.ROOT, "%.8f", embedding[i]));
        }
        sb.append(']');
        return sb.toString();
    }

    public void upsertResultEmbedding(int resultId, double[] embedding) {
        jdbc.update(
                "INSERT INTO result_embeddings (result_id, embedding, updated_at) "
                        + "VALUES (?, CAST(? AS vector), now()) "
                        + "ON CONFLICT (result_id) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = now()",
                resultId, vectorLiteral(embedding));
    }

    public record TitleRow(int id, String title) {}

    private static final RowMapper<TitleRow> TITLE_ROW = (rs, n) ->
            new TitleRow(rs.getInt("id"), rs.getString("title"));

    public List<TitleRow> fetchResultsMissingEmbeddings(String articleIlike, int days, int limit) {
        return jdbc.query(
                "SELECT r.id, r.title FROM results r "
                        + "INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id "
                        + "INNER JOIN articles a ON a.id = r.search_id "
                        + "WHERE a.enabled = TRUE "
                        + "  AND a.article ILIKE ? "
                        + "  AND sr.executed_at >= NOW() - (CAST(? AS int) * interval '1 day') "
                        + "  AND r.title IS NOT NULL "
                        + "  AND length(trim(r.title)) > 0 "
                        + "  AND NOT EXISTS (SELECT 1 FROM result_embeddings e WHERE e.result_id = r.id) "
                        + "ORDER BY r.id LIMIT ?",
                TITLE_ROW,
                "%" + articleIlike + "%", days, limit);
    }

    /** Evita warnings IDE “unused field”. */
    static Logger logger() { return log; }
}
