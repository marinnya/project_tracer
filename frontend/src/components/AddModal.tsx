import { useState, useEffect } from "react";
import "../styles/successModal.css";
import api from "../utils/api";

type Props = {
  onClose: () => void;
  onSave: (employee: {
    firstName: string;
    lastName: string;
    login: string;
    password: string;
    role: "ADMIN" | "EMPLOYEE";
    oneCId: string;
  }) => void;
  existingOneCIds: string[];
};

type OneCEmployee = {
  id: string;
  firstName: string;
  lastName: string;
};

const validateLogin = (login: string): string | null => {
  if (login.length < 5) return "Логин должен содержать не менее 5 символов";
  if (!/^[a-zA-Z0-9_]+$/.test(login))
    return "Логин может содержать только латинские буквы, цифры и _";
  return null;
};

const validatePassword = (password: string): boolean => {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
};

const PASSWORD_ERROR =
  "Пароль должен быть не менее 8 символов и содержать заглавную, строчную латинскую букву и цифру";

export default function AddModal({ onClose, onSave, existingOneCIds }: Props) {
  const [selectedOneCId, setSelectedOneCId] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState<OneCEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .get("/users/onec-employees")
      .then((res) => {
        const filtered = res.data.filter(
          (emp: OneCEmployee) => !existingOneCIds.includes(emp.id)
        );
        setEmployees(filtered);
      })
      .catch(() => setError("Не удалось загрузить список сотрудников"))
      .finally(() => setIsLoading(false));
  }, [existingOneCIds]);

  const handleSubmit = () => {
    setError("");

    if (!selectedOneCId) {
      setError("Выберите сотрудника из списка");
      return;
    }

    const loginError = validateLogin(login);
    if (loginError) {
      setError(loginError);
      return;
    }

    if (!validatePassword(password)) {
      setError(PASSWORD_ERROR);
      return;
    }

    const employeeObj = employees.find((e) => e.id === selectedOneCId);
    if (!employeeObj) {
      setError("Выберите сотрудника из списка");
      return;
    }

    onSave({
      firstName: employeeObj.firstName,
      lastName: employeeObj.lastName,
      login,
      password,
      role: "EMPLOYEE",
      oneCId: employeeObj.id,
    });

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal_edit" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ×
        </button>

        <h2>Добавление сотрудника</h2>

        <div className="modal-form">
          <div className="form-row">
            <label>Сотрудник</label>
            {isLoading ? (
              <select disabled>
                <option>Загрузка...</option>
              </select>
            ) : (
              <select
                value={selectedOneCId}
                onChange={(e) => setSelectedOneCId(e.target.value)}
              >
                <option value="">Выберите сотрудника</option>
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
            <input
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
                setError("");
              }}
              placeholder="Не менее 5 символов, латиница"
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
              placeholder="Не менее 8 символов"
            />
          </div>
        </div>

        {/* фиксированный слот под ошибку — кнопка не прыгает */}
        <div className="modal-error-slot">{error}</div>

        <button className="btn primary" onClick={handleSubmit}>
          Добавить
        </button>
      </div>
    </div>
  );
}