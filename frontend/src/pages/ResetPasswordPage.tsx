import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams(); // берём токен из URL (?token=xxx)
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError("");

    if (!password || !confirm) {
      setError("Заполните все поля");
      return;
    }

    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }

    if (password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message ?? "Ссылка недействительна или истекла");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Ошибка сервера — попробуйте позже");
    }
  };

  if (!token) {
    return (
      <div className="page">
        <div className="card">
          <p>Неверная ссылка для восстановления</p>
          <button className="primary" onClick={() => navigate("/login")}>Ко входу</button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="page">
        <div className="card">
          <p>Пароль успешно изменён!</p>
          <button className="primary" onClick={() => navigate("/login")}>Войти</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div className="info-row">
          <img src="/tracer.png" alt="tracer" className="info-icon" />
          <div className="info-title">Project Tracer</div>
          <div className="info-subtitle">Внесение данных о проектах</div>
        </div>
      </header>

      <div className="card">
        <h2>Новый пароль</h2>

        <input
          type="password"
          placeholder="Новый пароль"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
        />

        <input
          type="password"
          placeholder="Повторите пароль"
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value); setError(""); }}
        />

        {error && <div className="error">{error}</div>}

        <button className="primary" onClick={handleSubmit}>Сохранить пароль</button>
        <button className="link" onClick={() => navigate("/login")}>Вернуться ко входу</button>
      </div>
    </div>
  );
}