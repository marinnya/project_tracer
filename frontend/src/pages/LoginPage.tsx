import { useState } from "react";
import {useNavigate} from "react-router-dom";
import Recovery from "../components/Recovery";

// Тип роли пользователя
type Role = "employee" | "admin"

// Интерфейс с именем Props, ожидает передачу функции onSuccess (колбэк), которая ничего не принимает и не возвращает
interface Props {
    onSuccess: () => void;
}

export default function LoginPage({onSuccess}:Props){
    const [role, setRole] = useState<Role>("employee"); // состояние для роли пользователя
    const [login, setLogin] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [recovery, setRecovery] = useState(false);
    const navigate = useNavigate(); // хук из reat-router-dom, который позволяет программно менять маршрут /dashboard

    // async делает функцию ассинхронной, позволяет использовать await для ожидания завершения ассинхронный операций, не блокируя основной поток (можно кликать, кнопки не блокируются и т.д.)
    const handleSubmit = async () => {
        setError("");

        if (!login || !password) {
            setError("Заполните логин и пароль");
            return;
        }

        try {
            const response = await fetch (`${import.meta.env.VITE_API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // роль не передаём — она придёт из БД
            body: JSON.stringify({ login, password }),
            });

            if (!response.ok) {
            throw new Error("Ошибка авторизации");
            }

            const data = await response.json();

            // проверяем что выбранная вкладка совпадает с реальной ролью
            // это только UX-проверка, не безопасность
            if (data.role.toLowerCase() !== role) {
            setError("Неверная роль для этого аккаунта");
            return;
            }

            localStorage.setItem("token", data.access_token);
            localStorage.setItem("role", data.role);
            localStorage.setItem("login", data.login);
            localStorage.setItem("firstName", data.firstName);

            onSuccess();
            navigate("/");
        } catch (err) {
            console.error(err);
            setError("Неверный логин или пароль");
        }
        };

    // Если забыл пароль - открываем форму восстановления, передавая роль (пропс) в компонент Recoverry + колбэк-функия, через которую сообщаем родителю, что нужно закрыть режим восстановления
    if (recovery){
        return (
            <div className="page_recovery">
                <div className="card_recovery">
                    <Recovery role={role} onBack={() => setRecovery(false)} />
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
                <h2>Вход в личный кабинет</h2>

                {/*Переключение роли*/}
                <div className="tabs">
                    <button className={role === "employee" ? "active" : ""}
                        onClick={()=>setRole("employee")}
                        >Сотрудник
                    </button>

                    <button className={role === "admin" ? "active" : ""}
                        onClick={()=>setRole("admin")}
                        >Администратор
                    </button>
                </div>

                <input
                placeholder="Логин"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                />

                <input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                />

                {error && <div className="error">{error}</div>}

                <button className="primary" onClick={handleSubmit}>
                    Войти
                </button>

                <button className="link" onClick={()=>setRecovery(true)}>
                    Я забыл логин или пароль
                </button>
            </div>
        </div>
    );
}