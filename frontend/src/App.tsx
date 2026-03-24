import { useState, useEffect } from 'react'
import "./styles/login.css";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import ProjectPage from "./pages/ProjectPage";
import EmployeesPage from "./pages/EmployeesPage";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ResetPasswordPage from "./pages/ResetPasswordPage";

function App() {
  const [isAuth, setIsAuth] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); // пока проверяем токен — показываем загрузку

  // при запуске приложения проверяем токен в localStorage
  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) {
      setIsLoading(false); // токена нет — сразу на логин
      return;
    }

    // проверяем токен на бэкенде
    fetch("http://localhost:3000/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Токен недействителен");
        return res.json();
      })
      .then((data) => {
        // токен валидный — восстанавливаем сессию
        setIsAuth(true);
        setRole(data.role);
      })
      .catch(() => {
        // токен протух или пользователь заблокирован — чистим всё
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

  // пока проверяем токен — не рендерим ничего чтобы не было мигания экрана логина
  if (isLoading) return <div>Загрузка...</div>;

  return (
    <BrowserRouter>
      <Routes>
        {/* ЛОГИН — если уже авторизован, редиректим на главную */}
        <Route
          path="/login"
          element={
            isAuth
              ? <Navigate to="/" replace />
              : <LoginPage onSuccess={handleLoginSuccess} />
          }
        />

        {/* КОРЕНЬ — только авторизованные */}
        <Route
          path="/"
          element={
            isAuth ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" replace />
          }
        />

        {/* ПРОЕКТ — только авторизованные, передаём onLogout для Header */}
        <Route
          path="/projects/:id"
          element={
            isAuth ? <ProjectPage onLogout={handleLogout} /> : <Navigate to="/login" replace />
          }
        />

        {/* СОТРУДНИКИ — только админ, передаём onLogout для Header */}
        <Route
          path="/employees"
          element={
            isAuth && role === "ADMIN"
              ? <EmployeesPage onLogout={handleLogout} />
              : <Navigate to={isAuth ? "/" : "/login"} replace />
          }
        />

        {/* FALLBACK */}
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