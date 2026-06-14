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
  const [isAuth, setIsAuth] = useState(false); // хранит авторизован ли пользователь
  const [role, setRole] = useState<string | null>(null); // хранит роль пользователя
  const [isLoading, setIsLoading] = useState(true); // хранит флаг загрузки приложения

  // запускается 1 раз при загрузке App
  useEffect(() => {
    const token = localStorage.getItem("token"); // получаем токен из localStorage

    // если токена нет (пользователь не логинился), убираем загрузку и выходим из эффекта
    if (!token) {
      setIsLoading(false);
      return;
    }

    // берем адрес API
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

    // отправляем токен на бэкенд, чтобы проверить jwt и вернуть данные пользователя
    fetch(`${apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Токен недействителен");
        return res.json();
      })
      // если токен валидный, то устанавливаем isAuth и role
      .then((data) => {
        setIsAuth(true);
        setRole(data.role);
      })
      // если токен не валидный, то чистим localStorage
      .catch(() => {
        localStorage.clear();
      })
      // всегда выключаем спиннер
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // функция вызывается при успешном логине
  const handleLoginSuccess = () => {
    // устанавливаем isAuth и role из localStorage
    setIsAuth(true);
    setRole(localStorage.getItem("role"));
  };

  // функция вызывается при выходе из приложения
  const handleLogout = () => {
    localStorage.clear();
    setIsAuth(false);
    setRole(null);
  };

  // если еще идет проверка токена, то показываем спиннер
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