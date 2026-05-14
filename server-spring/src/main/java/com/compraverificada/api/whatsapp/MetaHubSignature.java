package com.compraverificada.api.whatsapp;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Valida cabecera {@code X-Hub-Signature-256} de Meta (HMAC-SHA256 del cuerpo crudo). */
public final class MetaHubSignature {
    private MetaHubSignature() {}

    public static boolean isValid(byte[] rawBody, String signatureHeader, String appSecret) {
        if (rawBody == null || rawBody.length == 0) {
            return false;
        }
        if (signatureHeader == null || !signatureHeader.startsWith("sha256=")) {
            return false;
        }
        String gotHex = signatureHeader.substring("sha256=".length());
        if (gotHex.length() % 2 != 0) {
            return false;
        }
        byte[] got;
        try {
            got = hexToBytes(gotHex);
        } catch (IllegalArgumentException e) {
            return false;
        }
        byte[] expected = hmacSha256(rawBody, appSecret.getBytes(StandardCharsets.UTF_8));
        if (got.length != expected.length) {
            return false;
        }
        return MessageDigest.isEqual(got, expected);
    }

    private static byte[] hmacSha256(byte[] data, byte[] key) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hexToBytes(String hex) {
        int n = hex.length();
        byte[] out = new byte[n / 2];
        for (int i = 0; i < n; i += 2) {
            out[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return out;
    }
}
