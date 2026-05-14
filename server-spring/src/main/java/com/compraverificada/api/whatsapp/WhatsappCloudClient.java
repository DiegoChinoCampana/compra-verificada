package com.compraverificada.api.whatsapp;

import com.compraverificada.api.config.WhatsappProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Envío de mensajes de texto por Graph API. */
@Component
public class WhatsappCloudClient {

    private static final Logger log = LoggerFactory.getLogger(WhatsappCloudClient.class);

    private final WhatsappProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    public WhatsappCloudClient(WhatsappProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
    }

    public void sendText(String to, String body) {
        String token = props.getCloudToken();
        String phoneId = props.getPhoneNumberId();
        if (token.isEmpty() || phoneId.isEmpty()) {
            log.warn("WhatsApp: cloud-token o phone-number-id vacíos; no se envía mensaje.");
            return;
        }
        String digits = to.replaceAll("\\D", "");
        String version = props.getGraphApiVersion();
        String url = "https://graph.facebook.com/" + version + "/" + phoneId + "/messages";

        ObjectNode root = mapper.createObjectNode();
        root.put("messaging_product", "whatsapp");
        root.put("to", digits);
        root.put("type", "text");
        ObjectNode text = mapper.createObjectNode();
        text.put("preview_url", false);
        text.put("body", body);
        root.set("text", text);
        String json;
        try {
            json = mapper.writeValueAsString(root);
        } catch (IOException e) {
            log.error("WhatsApp: serializar JSON", e);
            return;
        }

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(25))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 400) {
                log.error("WhatsApp send {}: {}", res.statusCode(), res.body().substring(0, Math.min(500, res.body().length())));
            }
        } catch (IOException | InterruptedException e) {
            log.error("WhatsApp send", e);
            Thread.currentThread().interrupt();
        }
    }
}
