import { useState, useEffect } from 'react'
import "./styles/login.css";
import "./styles/spinner.css";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import ProjectPage from "./pages/ProjectPage";
import EmployeesPage from "./pages/EmployeesPage";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ResetPasswordPage from "./pages/ResetPasswordPage";

function App() {
  const [isAuth, setIsAuth] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) {
      setIsLoading(false);
      return;
    }

    fetch("http://localhost:3000/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Токен недействителен");
        return res.json();
      })
      .then((data) => {
        setIsAuth(true);
        setRole(data.role);
      })
      .catch(() => {
        localStorage.clear();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleLoginSuccess = () => {
    setIsAuth(true);
    setRole(localStorage.getItem("role"));
  };

  const handleLogout = () => {
    localStorage.clear();
    setIsAuth(false);
    setRole(null);
  };

  if (isLoading) return (
    <div className="spinner-fullscreen">
      <div className="spinner" />
    </div>
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            isAuth
              ? <Navigate to="/" replace />
              : <LoginPage onSuccess={handleLoginSuccess} />
          }
        />

        <Route
          path="/"
          element={
            isAuth ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" replace />
          }
        />

        <Route
          path="/projects/:id"
          element={
            isAuth ? <ProjectPage onLogout={handleLogout} /> : <Navigate to="/login" replace />
          }
        />

        <Route
          path="/employees"
          element={
            isAuth && role === "ADMIN"
              ? <EmployeesPage onLogout={handleLogout} />
              : <Navigate to={isAuth ? "/" : "/login"} replace />
          }
        />

        <Route
          path="*"
          element={<Navigate to={isAuth ? "/" : "/login"} replace />}
        />

        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;