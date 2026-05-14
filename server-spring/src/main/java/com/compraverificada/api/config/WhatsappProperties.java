package com.compraverificada.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Credenciales y URLs del webhook WhatsApp Cloud API.
 * Valores en {@code application.yml} (se empaquetan en el WAR).
 */
@ConfigurationProperties(prefix = "cv.whatsapp")
public class WhatsappProperties {

    private String verifyToken = "";
    private String appSecret = "";
    private String cloudToken = "";
    private String phoneNumberId = "";
    private String publicAppBase = "https://compra-verificada.vercel.app";
    private String graphApiVersion = "v21.0";

    public String getVerifyToken() {
        return verifyToken;
    }

    public void setVerifyToken(String verifyToken) {
        this.verifyToken = verifyToken == null ? "" : verifyToken.trim();
    }

    public String getAppSecret() {
        return appSecret;
    }

    public void setAppSecret(String appSecret) {
        this.appSecret = appSecret == null ? "" : appSecret.trim();
    }

    public String getCloudToken() {
        return cloudToken;
    }

    public void setCloudToken(String cloudToken) {
        this.cloudToken = cloudToken == null ? "" : cloudToken.trim();
    }

    public String getPhoneNumberId() {
        return phoneNumberId;
    }

    public void setPhoneNumberId(String phoneNumberId) {
        this.phoneNumberId = phoneNumberId == null ? "" : phoneNumberId.trim();
    }

    public String getPublicAppBase() {
        return publicAppBase;
    }

    public void setPublicAppBase(String publicAppBase) {
        this.publicAppBase = publicAppBase == null ? "" : publicAppBase.trim().replaceAll("/+$", "");
    }

    public String getGraphApiVersion() {
        return graphApiVersion;
    }

    public void setGraphApiVersion(String graphApiVersion) {
        if (graphApiVersion == null || graphApiVersion.isEmpty()) {
            this.graphApiVersion = "v21.0";
        } else {
            String v = graphApiVersion.trim();
            this.graphApiVersion = v.startsWith("v") ? v : "v" + v;
        }
    }
}
