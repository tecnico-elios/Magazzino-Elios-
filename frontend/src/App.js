import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { InventoryProvider } from "@/lib/InventoryContext";
import { AuthProvider } from "@/lib/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import InventarioPage from "@/pages/InventarioPage";
import ArriviPage from "@/pages/ArriviPage";
import MovimentiPage from "@/pages/MovimentiPage";
import AnomaliePage from "@/pages/AnomaliePage";
import ChecklistPage from "@/pages/ChecklistPage";
import AdminPage from "@/pages/AdminPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import LoginPage from "@/pages/LoginPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <InventoryProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/inventario" element={<InventarioPage />} />
                <Route path="/arrivi" element={<ArriviPage />} />
                <Route path="/spedizioni" element={<ChecklistPage />} />
                <Route path="/movimenti" element={<MovimentiPage />} />
                <Route path="/anomalie" element={<AnomaliePage />} />
              </Route>
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/utenti"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminUsersPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </InventoryProvider>
        </AuthProvider>
      </BrowserRouter>
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          duration: 4000,
        }}
      />
    </div>
  );
}

export default App;
