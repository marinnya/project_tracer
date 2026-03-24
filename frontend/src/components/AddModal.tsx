import { useState } from "react";
import "../styles/successModal.css";

// Типы для пропсов
type Props = {
  onClose: () => void;
  // функция вызывается при сохранении данных сотрудника, работает с этими полями, ничего не возвращает (void)
  onSave: (employee: { firstName: string; lastName: string; login: string; password: string; role: "admin" | "employee" }) => void;
};

// Вариант выбора сотрудника (для выпадающего списка)
type EmployeeOption = {
  id: number;
  name: string;
};

// Заглушка — в будущем можно тянуть из 1С
const employees: EmployeeOption[] = [
  { id: 1, name: "Иван Иванов" },
  { id: 2, name: "Петр Петров" },
  { id: 3, name: "Алена Сидорова" },
  { id: 4, name: "Евгений Журавлев" },
];

// Копмонент работает с пропсами: onClose, onSave
export default function AddModal({ onClose, onSave }: Props) {
  const [employeeId, setEmployeeId] = useState<number | "">(""); // состояние хранит выбранного сотрудника по id
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [error, setError] = useState("");

  // функция проверяет заполнение полей
  const handleSubmit = () => {
    setError("");

    if (!login || !password || !employeeId) {
        setError("Заполните все поля");
        return;
    }

    // Находим выбранного сотрудника
    const employeeObj = employees.find((e) => e.id === employeeId);
    if (!employeeObj) {
        setError("Выберите сотрудника из списка");
        return;
    }

    const nameParts = employeeObj.name.split(" "); // делит строку на массив по пробелам ["Иван", "Иванов"]
    const firstName = nameParts[0] || "";  // имя
    const lastName = nameParts.slice(1).join(" ") || ""; // фамилия

    // Вызываем функцию добавления из пропсов, передаем объект сотрудника с полями
    onSave({
        firstName,
        lastName,
        login,
        password,
        role,
    });
    onClose(); // закрываем модалку
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal_edit" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Добавление сотрудника</h2>
        
        <div className="modal-form">
          <div className="form-row">
            <label>Сотрудник</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              <option value="">Выберите сотрудника</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Логин</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>

          <div className="form-row">
            <label>Пароль</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {/*<div className="form-row">
            <label>Роль</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "employee")}>
              <option value="employee">Сотрудник</option>
              <option value="admin">Администратор</option>
            </select>
          </div>*/}
        </div>

        {error && <div className="error">{error}</div>}
        <button className="btn primary" onClick={handleSubmit}>Добавить</button>
      </div>
    </div>
  );
}
