package com.compraverificada.api;

import com.compraverificada.api.config.WhatsappProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(WhatsappProperties.class)
public class CompraVerificadaApplication {
    public static void main(String[] args) {
        SpringApplication.run(CompraVerificadaApplication.class, args);
    }
}
