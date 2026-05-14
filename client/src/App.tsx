import { Navigate, Route, Routes } from "react-router-dom";
import { AnalysisLayout } from "./layout/AnalysisLayout";
import { Layout } from "./layout/Layout";
import { ArticleResultsPage } from "./pages/ArticleResultsPage";
import { ArticlesPage } from "./pages/ArticlesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AnalysisPeerGapPage } from "./pages/analysis/AnalysisPeerGapPage";
import { AnalysisPriceJumpsPage } from "./pages/analysis/AnalysisPriceJumpsPage";
import { AnalysisPriceStabilityPage } from "./pages/analysis/AnalysisPriceStabilityPage";
import { ResultsPage } from "./pages/ResultsPage";
import { OperationalPage } from "./pages/OperationalPage";
import { ClientReportPage } from "./pages/ClientReportPage";
import { HotSaleRoundupPage } from "./pages/HotSaleRoundupPage";
import { ReportPage } from "./pages/ReportPage";
import {
  DataDeletionPage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from "./pages/legal/MetaCompliancePages";
import "./App.css";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/articulos" replace />} />
        <Route path="articulos" element={<ArticlesPage />} />
        <Route path="resultados" element={<ResultsPage />} />
        <Route path="analisis" element={<AnalysisLayout />}>
          <Route index element={<Navigate to="/analisis/estabilidad-precios" replace />} />
          <Route path="estabilidad-precios" element={<AnalysisPriceStabilityPage />} />
          <Route path="brecha-peers" element={<AnalysisPeerGapPage />} />
          <Route path="saltos-precio" element={<AnalysisPriceJumpsPage />} />
        </Route>
        <Route path="articulos/:id/listados" element={<ArticleResultsPage />} />
        <Route path="articulos/:id" element={<DashboardPage />} />
        <Route path="informe/:id" element={<ReportPage />} />
        <Route path="guia-hot-sale" element={<HotSaleRoundupPage />} />
        <Route path="resumen/:id" element={<ClientReportPage />} />
        <Route path="operacion" element={<OperationalPage />} />
        <Route path="privacidad" element={<PrivacyPolicyPage />} />
        <Route path="terminos" element={<TermsOfServicePage />} />
        <Route path="eliminacion-datos" element={<DataDeletionPage />} />
      </Route>
    </Routes>
  );
}
