package com.compraverificada.api.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Si `cv.service.auth-token` está configurado, exige `Authorization: Bearer <token>`
 * para todas las rutas excepto `/health` (probe del LB / healthcheck del Tomcat).
 *
 * Pensado para ser el secreto compartido Node↔Spring (o front↔Spring) cuando
 * Spring sea el único frente público que toca la base.
 */
@Configuration
public class ServiceTokenFilter {

    @Bean
    public FilterRegistrationBean<TokenFilter> tokenFilter(
            @Value("${cv.service.auth-token:}") String token) {
        TokenFilter filter = new TokenFilter(token);
        FilterRegistrationBean<TokenFilter> reg = new FilterRegistrationBean<>(filter);
        reg.addUrlPatterns("/*");
        reg.setOrder(10);
        return reg;
    }

    public static class TokenFilter extends OncePerRequestFilter {
        private final String expected;

        public TokenFilter(String expected) {
            this.expected = expected == null ? "" : expected.trim();
        }

        @Override
        protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                throws ServletException, IOException {
            if (expected.isEmpty()) {
                chain.doFilter(req, res);
                return;
            }
            // Health probe siempre abierto.
            String path = req.getRequestURI();
            if (path != null && (path.endsWith("/health") || path.endsWith("/api/health"))) {
                chain.doFilter(req, res);
                return;
            }
            // CORS preflight no trae Authorization.
            if ("OPTIONS".equalsIgnoreCase(req.getMethod())) {
                chain.doFilter(req, res);
                return;
            }
            String header = req.getHeader("Authorization");
            String got = "";
            if (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7)) {
                got = header.substring(7).trim();
            }
            if (!expected.equals(got)) {
                res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Authorization Bearer requerido\"}");
                return;
            }
            chain.doFilter(req, res);
        }
    }
}
