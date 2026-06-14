import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

// правила валидации пароля — те же что в AddModal (true/false)
const validatePassword = (password: string): boolean => {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
};

// единое сообщение об ошибке пароля
const PASSWORD_ERROR =
  "Пароль должен быть не менее 8 символов и содержать заглавную, строчную латинскую букву и цифру";

export default function ResetPasswordPage() {
  // получаем объект searchParams, который содержит параметры URL
  const [searchParams] = useSearchParams();
  // получаем токен из URL ("abc123")
  const token = searchParams.get("token");
  const navigate = useNavigate(); // получаем функцию навигации

  const [password, setPassword] = useState(""); // новый пароль (изначально пустая строка)
  const [confirm, setConfirm] = useState(""); // повтор пароля
  const [error, setError] = useState(""); // ошибка
  const [success, setSuccess] = useState(false); // успех (пароль изменен/не изменен)

  // функция вызывается при нажатии кнопки
  const handleSubmit = async () => {
    setError(""); // очищаем ошибку, если была ранее

    if (!password || !confirm) {
      setError("Заполните все поля");
      return;
    }

    // проверка совпадения паролей
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }

    // валидация пароля (единое сообщение)
    if (!validatePassword(password)) {
      setError(PASSWORD_ERROR);
      return;
    }

    // отправляем запрос на бэкенд
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      // если сервер вернул ошибку, то устанавливаем ошибку и выходим из функции
      if (!res.ok) {
        const data = await res.json();
        setError(data.message ?? "Ссылка недействительна или истекла");
        return;
      }

      // если сервер вернул успешный ответ, то устанавливаем успех
      setSuccess(true);
    } catch {
      setError("Ошибка сервера — попробуйте позже");
    }
  };

  // если пользователь открыл страницу без токена, то показываем ошибку
  if (!token) {
    return (
      <div className="page">
        <div className="card">
          <p>Неверная ссылка для восстановления</p>
          <button className="primary" onClick={() => navigate("/login")}>
            Ко входу
          </button>
        </div>
      </div>
    );
  }

  // если пароль уже успешно изменен
  if (success) {
    return (
      <div className="page">
        <div className="card">
          <p>Пароль успешно изменён!</p>
          <button className="primary" onClick={() => navigate("/login")}>
            Войти
          </button>
        </div>
      </div>
    );
  }

  // если токен есть, нопароль еще не изменен, то показываем форму для ввода нового пароля
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
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
        />

        <input
          type="password"
          placeholder="Повторите пароль"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError("");
          }}
        />

        {error && <div className="error">{error}</div>}

        <button className="primary" onClick={handleSubmit}>
          Сохранить пароль
        </button>
        <button className="link" onClick={() => navigate("/login")}>
          Вернуться ко входу
        </button>
      </div>
    </div>
  );
}