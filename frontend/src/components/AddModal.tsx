import { useState, useEffect } from "react";
import "../styles/successModal.css";
import api from "../utils/api";

// Типы для пропсов
type Props = {
  onClose: () => void;
  // добавлен oneCId — нужен для связи сотрудника с проектами из 1С
  onSave: (employee: { firstName: string; lastName: string; login: string; password: string; role: "ADMIN" | "EMPLOYEE"; oneCId: string }) => void;
};

// тип сотрудника из 1С
type OneCEmployee = {
  id: string;       // oneCId — уникальный идентификатор в 1С
  firstName: string;
  lastName: string;
};

export default function AddModal({ onClose, onSave }: Props) {
  const [selectedOneCId, setSelectedOneCId] = useState(""); // выбранный сотрудник из 1С
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState<OneCEmployee[]>([]); // список сотрудников из 1С
  const [isLoading, setIsLoading] = useState(true); // загружаются ли сотрудники

  // загружаем список сотрудников из 1С при открытии модалки
  /*useEffect(() => {
    api.get("/users/onec-employees")
      .then(res => setEmployees(res.data))
      .catch(() => setError("Не удалось загрузить список сотрудников"))
      .finally(() => setIsLoading(false));
  }, []);*/


  useEffect(() => {
    api.get("/users/onec-employees")
      .then(res => setEmployees(res.data))
      .catch(() => setError("Не удалось загрузить список сотрудников"))
      .finally(() => setIsLoading(false));
  }, []);

  // функция проверяет заполнение полей
  const handleSubmit = () => {
    setError("");

    if (!login || !password || !selectedOneCId) {
      setError("Заполните все поля");
      return;
    }

    // находим выбранного сотрудника по oneCId
    const employeeObj = employees.find((e) => e.id === selectedOneCId);
    if (!employeeObj) {
      setError("Выберите сотрудника из списка");
      return;
    }

    // передаём данные в родительский компонент для сохранения
    onSave({
      firstName: employeeObj.firstName,
      lastName: employeeObj.lastName,
      login,
      password,
      role: "EMPLOYEE", // новые пользователи всегда сотрудники
      oneCId: employeeObj.id, // передаём oneCId для связи с проектами
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal_edit" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Добавление сотрудника</h2>

        <div className="modal-form">
          <div className="form-row">
            <label>Сотрудник</label>
            {isLoading ? (
              <select disabled><option>Загрузка...</option></select>
            ) : (
              <select value={selectedOneCId} onChange={(e) => setSelectedOneCId(e.target.value)}>
                <option value="">Выберите сотрудника</option>
                {/* список сотрудников из 1С */}
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-row">
            <label>Логин</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>

          <div className="form-row">
            <label>Пароль</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        <button className="btn primary" onClick={handleSubmit}>Добавить</button>
      </div>
    </div>
  );
}