import { useState } from "react";
import "../styles/successModal.css";
import type { Employee } from "../types/Employee";

// Типы для пропсов
type Props = {
  employee: Employee;
  onClose: () => void;
  // функция вызывается при редактировании данных сотрудника, работает с этими полями, ничего не возвращает (void)
  onSave: (id: number, updatedData: { login?: string; password?: string }) => void;
};

// Копмонент работает с пропсами: onClose, onSave
export default function EditModal({ employee, onClose, onSave }: Props) {
  const [login, setLogin] = useState(employee.login ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // функция проверяет заполнение полей
  const handleSubmit = () => {
    setError("");

    if (!login) {
      setError("Заполните логин");
      return;
    }

    // Вызываем функцию onSave из EmployeesPage, передаем объект сотрудника с полями
    onSave(employee.id, {
      login,
      password: password || undefined, // если пароль пустой, ничего не меняем
    });
    
    onClose(); // закрываем модалку
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
              onChange={(e) => setLogin(e.target.value)}
            />
          </div>

          <div className="form-row">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
