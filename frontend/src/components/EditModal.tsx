import { useState } from "react";
import "../styles/successModal.css";
import type { Employee } from "../types/Employee";

// Типы для пропсов
type Props = {
  employee: Employee;
  onClose: () => void;
  // функция вызывается при редактировании данных сотрудника, работает с этими полями, ничего не возвращает (void)
  onSave: (id: number, updatedData: { login?: string; password?: string }) => Promise<void>;
};

// правила валидации
const validateLogin = (login: string): string | null => {
  if (login.length < 5) return "Логин должен содержать не менее 5 символов";
  if (!/^[a-zA-Z0-9_]+$/.test(login))
    return "Логин может содержать только латинские буквы, цифры и _";
  return null;
};

// валидация пароля — единое правило
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

// Копмонент работает с пропсами: onClose, onSave
export default function EditModal({ employee, onClose, onSave }: Props) {
  const [login, setLogin] = useState(employee.login ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // функция проверяет заполнение полей
  const handleSubmit = async () => {
    setError("");

    if (!login) {
      setError("Заполните логин");
      return;
    }

    // валидация логина
    const loginError = validateLogin(login);
    if (loginError) {
      setError(loginError);
      return;
    }

    // валидация пароля (если введён)
    if (password && !validatePassword(password)) {
      setError(PASSWORD_ERROR);
      return;
    }

    try {
      // Вызываем функцию onSave из EmployeesPage, передаем объект сотрудника с полями
      await onSave(employee.id, {
        login,
        password: password || undefined, // если пароль пустой, ничего не меняем
      });

      onClose(); // закрываем модалку ТОЛЬКО если всё успешно
    } catch (err: any) {
      // показываем ошибку от бэка (например "Логин уже занят")
      setError(err.response?.data?.message || "Ошибка при сохранении");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal_edit" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ×
        </button>

        <h2>Редактирование сотрудника</h2>

        <div className="modal-form">
          <div className="form-row">
            <label>Сотрудник</label>
            <select value={employee.id} disabled>
              <option value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            </select>
          </div>

          <div className="form-row">
            <label>Логин</label>
            <input
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
                setError("");
              }}
            />
          </div>

          <div className="form-row">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="Новый пароль (если нужно)"
            />
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn primary" onClick={handleSubmit}>
          Сохранить
        </button>
      </div>
    </div>
  );
}