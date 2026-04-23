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
import { ReportPage } from "./pages/ReportPage";
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
        <Route path="operacion" element={<OperationalPage />} />
      </Route>
    </Routes>
  );
}
