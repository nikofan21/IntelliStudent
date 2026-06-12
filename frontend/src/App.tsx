import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import Login from "./pages/Login";
import Students from "./pages/Students";
import Upload from "./pages/Upload";
import SearchPage from "./pages/Search";
import Dashboard from "./pages/Dashboard";
import AdminDocuments from "./pages/AdminDocuments";
import UnassignedDocuments from "./pages/UnassignedDocuments";

import { getToken } from "./lib/auth";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="upload" element={<Upload />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="admin/documents" element={<AdminDocuments />} />
        <Route
          path="unassigned-documents"
          element={<UnassignedDocuments />}
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}