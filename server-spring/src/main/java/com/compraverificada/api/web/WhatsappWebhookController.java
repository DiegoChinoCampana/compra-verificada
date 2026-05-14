package com.compraverificada.api.web;

import com.compraverificada.api.config.WhatsappProperties;
import com.compraverificada.api.whatsapp.MetaHubSignature;
import com.compraverificada.api.whatsapp.WhatsappBotService;
import com.compraverificada.api.whatsapp.WhatsappCloudClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * WhatsApp Cloud API — verificación GET (challenge) y eventos POST.
 * <p>Ruta efectiva con {@code server.servlet.context-path=/api}: {@code /api/meta/whatsapp/webhook}.
 */
@RestController
@RequestMapping("/meta/whatsapp/webhook")
public class WhatsappWebhookController {

    private static final Logger log = LoggerFactory.getLogger(WhatsappWebhookController.class);

    private final WhatsappProperties props;
    private final WhatsappBotService bot;
    private final WhatsappCloudClient cloud;
    private final ObjectMapper mapper;

    public WhatsappWebhookController(
            WhatsappProperties props,
            WhatsappBotService bot,
            WhatsappCloudClient cloud,
            ObjectMapper mapper) {
        this.props = props;
        this.bot = bot;
        this.cloud = cloud;
        this.mapper = mapper;
    }

    @GetMapping
    public void verify(HttpServletRequest req, HttpServletResponse res) throws IOException {
        String vt = props.getVerifyToken();
        res.setCharacterEncoding("UTF-8");
        if (vt.isEmpty()) {
            res.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            res.setContentType("text/plain;charset=UTF-8");
            res.getWriter().write("META_WHATSAPP_VERIFY_TOKEN no configurado");
            return;
        }
        String mode = req.getParameter("hub.mode");
        String token = req.getParameter("hub.verify_token");
        String challenge = req.getParameter("hub.challenge");
        String tokenTrim = token == null ? "" : token.trim();
        if ("subscribe".equals(mode) && vt.equals(tokenTrim) && challenge != null && !challenge.isEmpty()) {
            res.setStatus(HttpServletResponse.SC_OK);
            res.setContentType("text/plain;charset=UTF-8");
            res.getWriter().write(challenge);
            return;
        }
        log.warn(
                "WhatsApp GET verify falló: mode={} tokenOk={} hasChallenge={}",
                mode,
                vt.equals(tokenTrim),
                challenge != null && !challenge.isEmpty());
        res.setStatus(HttpServletResponse.SC_FORBIDDEN);
        res.setContentType("text/plain;charset=UTF-8");
        res.getWriter().write("Forbidden");
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> receive(
            @RequestBody byte[] rawBody,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature) {
        String secret = props.getAppSecret();
        if (!secret.isEmpty()) {
            if (!MetaHubSignature.isValid(rawBody, signature, secret)) {
                return ResponseEntity.status(401).body(Map.of("error", "Invalid signature"));
            }
        } else {
            log.warn("cv.whatsapp.app-secret vacío: webhook POST sin validar firma.");
        }
        try {
            JsonNode root = mapper.readTree(rawBody);
            List<Inbound> msgs = extractMessages(root);
            for (Inbound m : msgs) {
                List<String> replies = bot.handleInboundText(m.from(), m.text());
                for (String reply : replies) {
                    cloud.sendText(m.from(), reply);
                }
            }
        } catch (Exception e) {
            log.error("WhatsApp webhook POST", e);
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private record Inbound(String from, String text) {}

    private List<Inbound> extractMessages(JsonNode root) {
        List<Inbound> out = new ArrayList<>();
        JsonNode entries = root.get("entry");
        if (entries == null || !entries.isArray()) {
            return out;
        }
        for (JsonNode ent : entries) {
            JsonNode changes = ent.get("changes");
            if (changes == null || !changes.isArray()) {
                continue;
            }
            for (JsonNode ch : changes) {
                JsonNode value = ch.get("value");
                if (value == null) {
                    continue;
                }
                JsonNode messages = value.get("messages");
                if (messages == null || !messages.isArray()) {
                    continue;
                }
                for (JsonNode msg : messages) {
                    if (!"text".equals(textOrNull(msg.get("type")))) {
                        continue;
                    }
                    JsonNode textNode = msg.get("text");
                    if (textNode == null) {
                        continue;
                    }
                    String body = textOrNull(textNode.get("body"));
                    String from = textOrNull(msg.get("from"));
                    if (from != null && body != null) {
                        out.add(new Inbound(from, body));
                    }
                }
            }
        }
        return out;
    }

    private static String textOrNull(JsonNode n) {
        return n == null || n.isNull() || !n.isTextual() ? null : n.asText();
    }
}
