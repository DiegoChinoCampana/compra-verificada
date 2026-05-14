package com.compraverificada.api.whatsapp;

import com.compraverificada.api.config.WhatsappProperties;
import com.compraverificada.api.sql.SqlSnippets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class WhatsappBotService {

    private static final Logger log = LoggerFactory.getLogger(WhatsappBotService.class);
    private static final int SHOW_COUNT = 12;
    private static final int LIST_LIMIT = 120;
    private static final int CONSULT_DAYS = 60;
    private static final ZoneId AR = ZoneId.of("America/Argentina/Buenos_Aires");

    private final NamedParameterJdbcTemplate jdbc;
    private final WhatsappProperties whatsappProps;

    public WhatsappBotService(NamedParameterJdbcTemplate jdbc, WhatsappProperties whatsappProps) {
        this.jdbc = jdbc;
        this.whatsappProps = whatsappProps;
    }

    public List<String> handleInboundText(String from, String textRaw) {
        String text = textRaw == null ? "" : textRaw.trim();
        String lower = text.toLowerCase(Locale.ROOT);

        if (text.isEmpty() || "menu".equals(lower) || "reiniciar".equals(lower) || "inicio".equals(lower)) {
            WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
            return List.of(replyMenu());
        }

        WhatsappSessionStore.WaSession sess = WhatsappSessionStore.get(from);
        if (sess == null) {
            sess = WhatsappSessionStore.newMenu();
        }

        if (sess.flow == WhatsappSessionStore.Flow.MENU && "menu".equals(sess.step)) {
            if ("1".equals(lower) || lower.startsWith("1 ") || lower.contains("seguir")) {
                return startFollow(from);
            }
            if ("2".equals(lower) || lower.startsWith("2 ") || lower.contains("consultar")) {
                return startConsult(from);
            }
            return List.of("No reconocí la opción. Escribí *1* para dar de alta un producto o *2* para consultar precios.");
        }

        if (sess.flow == WhatsappSessionStore.Flow.FOLLOW) {
            return handleFollow(from, sess, text);
        }
        if (sess.flow == WhatsappSessionStore.Flow.CONSULT) {
            return handleConsult(from, sess, text);
        }

        WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
        return List.of(replyMenu());
    }

    private List<String> startFollow(String from) {
        List<String> types = distinctArticleTypes();
        FormattedList fl = formatNumberedList("¿Qué *tipo* de artículo es?", types);
        WhatsappSessionStore.WaSession next = new WhatsappSessionStore.WaSession(
                WhatsappSessionStore.Flow.FOLLOW,
                "choose_article",
                new WhatsappSessionStore.Draft("", "", ""),
                fl.shown());
        WhatsappSessionStore.put(from, next);
        return List.of(fl.text());
    }

    private List<String> startConsult(String from) {
        List<String> types = distinctArticleTypes();
        FormattedList fl = formatNumberedList("Consulta: ¿qué *tipo* de artículo?", types);
        WhatsappSessionStore.WaSession next = new WhatsappSessionStore.WaSession(
                WhatsappSessionStore.Flow.CONSULT,
                "choose_article",
                new WhatsappSessionStore.Draft("", "", ""),
                fl.shown());
        WhatsappSessionStore.put(from, next);
        return List.of(fl.text());
    }

    private String publicBase() {
        String b = whatsappProps.getPublicAppBase();
        return b.isEmpty() ? "https://compra-verificada.vercel.app" : b;
    }

    private String replyMenu() {
        return "¡Hola! Soy el asistente de *CompraVerificada*.\n\n"
                + "Elegí una opción (respondé con el número):\n\n"
                + "*1* — *Seguir* un producto: lo damos de alta y lo buscamos en Mercado Libre.\n\n"
                + "*2* — *Consultar* precios: variación aproximada de los últimos *" + CONSULT_DAYS
                + "* días con nuestros datos.\n\n"
                + "_Escribí *menu* cuando quieras volver acá._";
    }

    private List<String> handleFollow(String from, WhatsappSessionStore.WaSession sess, String text) {
        if ("choose_article".equals(sess.step)) {
            String pick = normalizeChoice(text, sess.lastOptions);
            String article = pick != null ? pick : text.trim();
            sess.draft = new WhatsappSessionStore.Draft(article, sess.draft.brand(), sess.draft.detail());
            sess.step = "choose_brand";
            List<String> brands = distinctBrandsForArticle(sess.draft.article());
            FormattedList fl = formatNumberedList("Marca para *" + sess.draft.article() + "*:", brands);
            sess.lastOptions = fl.shown();
            WhatsappSessionStore.put(from, sess);
            return List.of(fl.text());
        }
        if ("choose_brand".equals(sess.step)) {
            String pick = normalizeChoice(text, sess.lastOptions);
            String brand = pick != null ? pick : text.trim();
            sess.draft = new WhatsappSessionStore.Draft(sess.draft.article(), brand, sess.draft.detail());
            sess.step = "choose_detail";
            List<String> details = distinctDetails(sess.draft.article(), sess.draft.brand());
            FormattedList fl = formatNumberedList("Modelo / *detalle*:", details);
            sess.lastOptions = fl.shown();
            WhatsappSessionStore.put(from, sess);
            return List.of(fl.text());
        }
        if ("choose_detail".equals(sess.step)) {
            String pick = normalizeChoice(text, sess.lastOptions);
            String detail = pick != null ? pick : text.trim();
            var triple = new WhatsappSessionStore.Draft(sess.draft.article(), sess.draft.brand(), detail);
            try {
                InsertResult r = insertArticleTriple(triple.article(), triple.brand(), triple.detail());
                String base = publicBase();
                String msg = r.existed()
                        ? "Ese producto *ya estaba* en seguimiento (ID " + r.id() + ").\nVer resumen: " + base + "/resumen/"
                                + r.id()
                        : "Listo. *Dimos de alta* el producto (ID " + r.id()
                                + "). Aparecerá en las próximas búsquedas en ML.\nResumen público: " + base + "/resumen/"
                                + r.id();
                WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
                return List.of(msg);
            } catch (Exception e) {
                log.error("whatsapp insert article", e);
                return List.of("Hubo un error al guardar. Probá de nuevo más tarde o escribí *menu*.");
            }
        }
        WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
        return List.of(replyMenu());
    }

    private List<String> handleConsult(String from, WhatsappSessionStore.WaSession sess, String text) {
        if ("choose_article".equals(sess.step)) {
            String pick = normalizeChoice(text, sess.lastOptions);
            String article = pick != null ? pick : text.trim();
            sess.draft = new WhatsappSessionStore.Draft(article, sess.draft.brand(), sess.draft.detail());
            sess.step = "choose_brand";
            List<String> brands = distinctBrandsForArticle(sess.draft.article());
            FormattedList fl = formatNumberedList("Marca para *" + sess.draft.article() + "*:", brands);
            sess.lastOptions = fl.shown();
            WhatsappSessionStore.put(from, sess);
            return List.of(fl.text());
        }
        if ("choose_brand".equals(sess.step)) {
            String pick = normalizeChoice(text, sess.lastOptions);
            String brand = pick != null ? pick : text.trim();
            sess.draft = new WhatsappSessionStore.Draft(sess.draft.article(), brand, sess.draft.detail());
            sess.step = "choose_detail";
            List<String> details = distinctDetails(sess.draft.article(), sess.draft.brand());
            FormattedList fl = formatNumberedList("Modelo / *detalle*:", details);
            sess.lastOptions = fl.shown();
            WhatsappSessionStore.put(from, sess);
            return List.of(fl.text());
        }
        if ("choose_detail".equals(sess.step)) {
            String pick = normalizeChoice(text, sess.lastOptions);
            String detail = pick != null ? pick : text.trim();
            sess.draft = new WhatsappSessionStore.Draft(sess.draft.article(), sess.draft.brand(), detail);
            sess.step = "consult_price_note";
            WhatsappSessionStore.put(from, sess);
            return List.of(
                    "Si querés, contanos *qué precio viste* y *dónde* (opcional). No lo guardamos por ahora; nos ayuda en el mensaje siguiente.\n\n"
                            + "Escribí el dato o *-* para omitir.");
        }
        if ("consult_price_note".equals(sess.step)) {
            String note = (text != null && !text.trim().matches("^[_.\\-\\s]+$") && !"no".equalsIgnoreCase(text.trim()))
                    ? text.trim()
                    : "";
            Integer id = resolveArticleId(sess.draft);
            if (id == null) {
                WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
                return List.of(
                        "No tenemos en base un artículo que coincida exactamente con:\n*"
                                + sess.draft.article()
                                + "* · "
                                + sess.draft.brand()
                                + " · "
                                + sess.draft.detail()
                                + "\n\nPodés darlo de alta con la opción *1* del menú. Escribí *menu*.");
            }
            List<Map<String, Object>> series = fetchPriceSeriesLastDays(id, CONSULT_DAYS);
            String body = formatPriceSeries(series, sess.draft, note);
            String footer = "\n\nMás detalle: " + publicBase() + "/resumen/" + id;
            WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
            return List.of(body + footer);
        }
        WhatsappSessionStore.put(from, WhatsappSessionStore.newMenu());
        return List.of(replyMenu());
    }

    private record FormattedList(String text, List<String> shown) {}

    private FormattedList formatNumberedList(String title, List<String> options) {
        List<String> shown = options.size() > SHOW_COUNT ? options.subList(0, SHOW_COUNT) : new ArrayList<>(options);
        StringBuilder body = new StringBuilder(title).append("\n\n");
        if (shown.isEmpty()) {
            body.append("_(No hay valores en la base; escribí uno.)_\n\n");
        } else {
            for (int i = 0; i < shown.size(); i++) {
                body.append(i + 1).append(". ").append(shown.get(i)).append("\n");
            }
            if (options.size() > shown.size()) {
                body.append("\n…y ").append(options.size() - shown.size()).append(" más (podés escribir el texto exacto).\n");
            }
        }
        body.append("\nRespondé con el *número* o escribí un valor *nuevo*. Escribí *menu* para volver.");
        return new FormattedList(body.toString(), shown);
    }

    private static String normalizeChoice(String text, List<String> options) {
        if (text == null || options == null || options.isEmpty()) {
            return null;
        }
        String t = text.trim();
        if (t.matches("^\\d+$")) {
            int idx = Integer.parseInt(t) - 1;
            if (idx >= 0 && idx < options.size()) {
                return options.get(idx);
            }
        }
        return null;
    }

    private List<String> distinctArticleTypes() {
        String sql = "SELECT DISTINCT trim(article) AS v FROM articles WHERE enabled = true "
                + "AND article IS NOT NULL AND trim(article) <> '' ORDER BY v LIMIT " + LIST_LIMIT;
        return jdbc.query(sql, rs -> {
            List<String> out = new ArrayList<>();
            while (rs.next()) {
                out.add(rs.getString("v"));
            }
            return out;
        });
    }

    private List<String> distinctBrandsForArticle(String article) {
        String sql = "SELECT DISTINCT trim(brand) AS v FROM articles WHERE enabled = true "
                + "AND lower(trim(article)) = lower(trim(CAST(:article AS text))) "
                + "AND brand IS NOT NULL AND trim(brand) <> '' ORDER BY v LIMIT " + LIST_LIMIT;
        return jdbc.query(
                sql,
                new MapSqlParameterSource("article", article),
                rs -> {
                    List<String> out = new ArrayList<>();
                    while (rs.next()) {
                        out.add(rs.getString("v"));
                    }
                    return out;
                });
    }

    private List<String> distinctDetails(String article, String brand) {
        String sql = "SELECT DISTINCT trim(detail) AS v FROM articles WHERE enabled = true "
                + "AND lower(trim(article)) = lower(trim(CAST(:article AS text))) "
                + "AND lower(trim(coalesce(brand, ''))) = lower(trim(coalesce(CAST(:brand AS text), ''))) "
                + "AND detail IS NOT NULL AND trim(detail) <> '' ORDER BY v LIMIT " + LIST_LIMIT;
        return jdbc.query(
                sql,
                new MapSqlParameterSource("article", article).addValue("brand", brand == null ? "" : brand),
                rs -> {
                    List<String> out = new ArrayList<>();
                    while (rs.next()) {
                        out.add(rs.getString("v"));
                    }
                    return out;
                });
    }

    public record InsertResult(int id, boolean existed) {}

    private InsertResult insertArticleTriple(String article, String brand, String detail) {
        String a = article.trim();
        String b = brand == null ? "" : brand.trim();
        String d = detail == null ? "" : detail.trim();
        if (a.isEmpty()) {
            throw new IllegalArgumentException("article_required");
        }
        MapSqlParameterSource q = new MapSqlParameterSource()
                .addValue("article", a)
                .addValue("brand", b.isEmpty() ? null : b)
                .addValue("detail", d.isEmpty() ? null : d);
        List<Integer> existing = jdbc.query(
                "SELECT id FROM articles WHERE lower(trim(article)) = lower(trim(CAST(:article AS text))) "
                        + "AND lower(trim(coalesce(brand, ''))) = lower(trim(coalesce(CAST(:brand AS text), ''))) "
                        + "AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), ''))) "
                        + "LIMIT 1",
                q,
                (rs, rowNum) -> rs.getInt("id"));
        if (!existing.isEmpty()) {
            return new InsertResult(existing.get(0), true);
        }
        Integer id = jdbc.queryForObject(
                "INSERT INTO articles (article, brand, detail, enabled, ordered_by) "
                        + "VALUES (:article, :brand, :detail, true, 'Más relevantes') RETURNING id",
                q,
                Integer.class);
        return new InsertResult(id == null ? 0 : id, false);
    }

    private Integer resolveArticleId(WhatsappSessionStore.Draft draft) {
        MapSqlParameterSource q = new MapSqlParameterSource()
                .addValue("article", draft.article())
                .addValue("brand", draft.brand() == null ? "" : draft.brand())
                .addValue("detail", draft.detail() == null ? "" : draft.detail());
        List<Integer> ids = jdbc.query(
                "SELECT id FROM articles WHERE enabled = true "
                        + "AND lower(trim(article)) = lower(trim(CAST(:article AS text))) "
                        + "AND lower(trim(coalesce(brand, ''))) = lower(trim(coalesce(CAST(:brand AS text), ''))) "
                        + "AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), ''))) "
                        + "ORDER BY id DESC LIMIT 1",
                q,
                (rs, rowNum) -> rs.getInt("id"));
        return ids.isEmpty() ? null : ids.get(0);
    }

    private List<Map<String, Object>> fetchPriceSeriesLastDays(int articleId, int days) {
        String sql = "WITH " + SqlSnippets.runsOnePerDayCte() + """
                SELECT
                  sr.executed_at,
                  MIN(r.price)::float8 AS min_price,
                  AVG(r.price)::float8 AS avg_price,
                  COUNT(*)::int AS listing_count
                FROM results r
                JOIN scrape_runs sr ON sr.id = r.scrape_run_id
                JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
                WHERE r.search_id = :articleId AND r.price IS NOT NULL
                  AND sr.executed_at >= NOW() - (CAST(:days AS int) * INTERVAL '1 day')
                GROUP BY sr.id, sr.executed_at
                ORDER BY sr.executed_at ASC
                """;
        return jdbc.queryForList(
                sql, new MapSqlParameterSource("articleId", articleId).addValue("days", days));
    }

    private String formatPriceSeries(
            List<Map<String, Object>> rows, WhatsappSessionStore.Draft draft, String userNote) {
        DateTimeFormatter df = DateTimeFormatter.ofPattern("d MMM yyyy").withLocale(new Locale("es", "AR")).withZone(AR);
        String head = "*"
                + draft.article()
                + "* · "
                + (draft.brand().isEmpty() ? "—" : draft.brand())
                + " · "
                + (draft.detail().isEmpty() ? "—" : draft.detail())
                + "\nÚltimos "
                + CONSULT_DAYS
                + " días (Mercado Libre, según nuestros relevamientos):\n";
        if (rows.isEmpty()) {
            return head
                    + "\nNo hay historial reciente en la base para esta combinación. Si acabás de dar de alta el producto, puede tardar en aparecer datos.";
        }
        double minAll = rows.stream()
                .mapToDouble(r -> ((Number) r.get("min_price")).doubleValue())
                .min()
                .orElse(0);
        double maxAll = rows.stream()
                .mapToDouble(r -> ((Number) r.get("min_price")).doubleValue())
                .max()
                .orElse(0);
        Map<String, Object> first = rows.get(0);
        Map<String, Object> last = rows.get(rows.size() - 1);
        String d0 = df.format(toInstant(first.get("executed_at")));
        String d1 = df.format(toInstant(last.get("executed_at")));
        double fmin = ((Number) first.get("min_price")).doubleValue();
        double lmin = ((Number) last.get("min_price")).doubleValue();
        String t = head + "\n• Primer día del período ("
                + d0
                + "): precio mínimo relevado "
                + ars(fmin)
                + ".\n"
                + "• Último día ("
                + d1
                + "): mínimo "
                + ars(lmin)
                + ".\n"
                + "• Rango de mínimos día a día: "
                + ars(minAll)
                + " – "
                + ars(maxAll)
                + ".\n"
                + "• Puntos en la serie: "
                + rows.size()
                + " (una corrida por día calendario con datos).";
        if (userNote != null && !userNote.isEmpty()) {
            t += "\n\n(Dato que compartiste: " + userNote + ")";
        }
        return t;
    }

    private static String ars(double n) {
        return String.format(Locale.forLanguageTag("es-AR"), "$%,.0f", n);
    }

    private static Instant toInstant(Object executedAt) {
        if (executedAt instanceof Timestamp ts) {
            return ts.toInstant();
        }
        if (executedAt instanceof java.util.Date d) {
            return d.toInstant();
        }
        if (executedAt instanceof Instant i) {
            return i;
        }
        return Instant.EPOCH;
    }
}
