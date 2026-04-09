import { useState, useEffect, useRef, useCallback } from "react";
import "../styles/dashboard.css";
import Header from "../components/Header";
import AddModal from "../components/AddModal";
import EditModal from "../components/EditModal";
import BlockModal from "../components/BlockModal";
import DeleteModal from "../components/DeleteModal";
import type { Employee } from "../types/Employee";
import { useClickOutside } from "../hooks/useClickOutside";
import api from "../utils/api";

// тип сотрудника для списка на странице
type EmployeeData = {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  isBlocked: boolean;
  role: string;
};

// пропс onLogout передаётся из App.tsx и пробрасывается в Header
type Props = {
  onLogout: () => void;
};

export default function EmployeesPage({ onLogout }: Props) {
  const [showArchive, setShowArchive] = useState(false); // состояние для заблокированных сотрудников
  const [showModalAdd, setShowModalAdd] = useState(false); // состояние для модального окна добавления
  const [showModalEdit, setShowModalEdit] = useState(false); // состояние для модального окна редактирования
  const [showModalBlock, setShowModalBlock] = useState(false); // состояние для модального окна блокировки
  const [showModalDelete, setShowModalDelete] = useState(false); // состояние для модального окна удаления
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null); // состояние для выбранного сотрудника
  const [filterOpen, setFilterOpen] = useState(false); // состояние для окна фильтров (мобильное)
  const [employees, setEmployees] = useState<EmployeeData[]>([]); // состояние для загрузки сотрудников на страницу

  // useRef - хук, который создаёт ссылку на DOM-элемент
  const filterRef = useRef<HTMLDivElement>(null);
  // пользовательский хук, который реагирует на клики вне указанного элемента
  useClickOutside(filterRef as React.RefObject<HTMLElement>, () => setFilterOpen(false));

  // если выбран архив, показываем только заблокированных
  const filteredEmployees = employees.filter(emp =>
    showArchive ? emp.isBlocked : !emp.isBlocked
  );

  // асинхронная функция для получения сотрудников
  // асинхронная функция для получения сотрудников — используется после добавления/редактирования/удаления
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await api.get<EmployeeData[]>("/users");
      setEmployees(res.data); // бэкенд уже отфильтровал
    } catch (err) {
      console.error(err);
    }
  }, []);

  // загружаем сотрудников при монтировании компонента
  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // редактирование; функция принимает объект сотрудника и сохраняет его в состояние
  const openEditModal = (emp: Employee) => {
    setSelectedEmployee(emp); // всегда кладём того, по кому кликнули
    setShowModalEdit(true); // открываем модальное окно
  };

  // блокировка
  const openBlockModal = (emp: Employee) => {
    setSelectedEmployee(emp); // всегда кладём того, по кому кликнули
    setShowModalBlock(true);
  };

  // удаление
  const openDeleteModal = (emp: Employee) => {
    setSelectedEmployee(emp); // всегда кладём того, по кому кликнули
    setShowModalDelete(true);
  };

  // Асинхронная функция для добавления: принимает объект нового сотрудника
  const addEmployee = async (newEmployee: { firstName: string; lastName: string; login: string; password: string; role: string; oneCId: string }) => {
    try {
      await api.post("/users/", newEmployee); // токен подставляется автоматически
      await fetchEmployees(); // после успешного добавления заново загружаем список сотрудников
    } catch (err) {
      console.error(err);
    }
  };

  // Асинхронная функция для редактирования: принимает id сотрудника и измененные поля (можно не все)
  const editEmployee = async (id: number, updatedData: Partial<EmployeeData>) => {
    try {
      await api.patch(`/users/${id}`, updatedData); // отправляем только измененные поля
      await fetchEmployees(); // снова загружаем список сотрудников
    } catch (err) {
      console.error(err);
    }
  };

  // Асинхронная функция для блокировки/разблокировки: принимает id сотрудника и block
  const toggleBlockEmployee = async (id: number, block: boolean) => {
    try {
      await api.patch(`/users/${id}/block`, { value: block });
      await fetchEmployees();
    } catch (err) {
      console.error(err);
    }
  };

  // Асинхронная функция для удаления: принимает id сотрудника
  const deleteEmployee = async (id: number) => {
    try {
      await api.delete(`/users/${id}`);
      await fetchEmployees();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="dashboard">
      {/* пробрасываем onLogout в Header */}
      <Header onLogout={onLogout} />
      <main className="content">
        <div className="content-header">
          <div className="header-title">
            <h1>Сотрудники</h1>
            {/* Мобильная кнопка */}
            <button className="add-icon-btn mobile-only" onClick={() => setShowModalAdd(true)} aria-label="Добавить сотрудника">
              <img src="/add_circle.png" alt="" />
            </button>
          </div>

          {/* Десктопная кнопка */}
          <div className="header-actions desktop-only">
            <button className="add-btn" onClick={() => setShowModalAdd(true)}>
              <img src="/add_circle.png" alt="" />
              <span className="add-text">Добавить сотрудника</span>
            </button>
          </div>

          {/* AddModal - дочерний компонент, передаем ему 2 пропса: onClose и onSave для добавления сотрудника */}
          {showModalAdd && (<AddModal onClose={() => setShowModalAdd(false)} onSave={addEmployee} />)}

          {/* Десктопные фильтры */}
          <div className="filters desktop-only">
            <button className={!showArchive ? "active" : ""} onClick={() => setShowArchive(false)}>Активные</button>
            <button className={showArchive ? "active" : ""} onClick={() => setShowArchive(true)}>Заблокированные</button>
          </div>

          {/* Мобильные фильтры, ссылка на элемент для закрытия при внешнем клике */}
          <div className="mobile-only" ref={filterRef}>
            <button className="filter-icon-btn" onClick={() => setFilterOpen((prev) => !prev)}>
              <img src="/filter.png" alt="Фильтр" />
            </button>

            {filterOpen && (
              <div className="filter-dropdown">
                <button className={!showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(false); setFilterOpen(false); }}>
                  Активные
                </button>
                <button className={showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(true); setFilterOpen(false); }}>
                  Заблокированные
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="projects-desktop">
          <table className="projects-table">
            <thead>
              <tr>
                <th>Фамилия Имя</th>
                <th>Логин</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td className="name">{employee.firstName} {employee.lastName}</td>
                  <td>{employee.login}</td>
                  <td>{employee.isBlocked ? "Заблокирован" : "Активен"}</td>
                  <td className="status-actions">
                    <span className="status edit" onClick={(e) => { e.stopPropagation(); openEditModal(employee as unknown as Employee); }}>Редактировать</span>
                    <span className="status block" onClick={(e) => { e.stopPropagation(); openBlockModal(employee as unknown as Employee); }}>{employee.isBlocked ? "Разблокировать" : "Блокировать"}</span>
                    <span className="status delete" onClick={(e) => { e.stopPropagation(); openDeleteModal(employee as unknown as Employee); }}>Удалить</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Мобильная версия */}
        <div className="employees-mobile">
          {employees.map(employee => (
            <div key={employee.id} className="employee-card">
              <div className="employee-info">
                <div className="employee-name">{employee.firstName} {employee.lastName}</div>
                <div className="employee-credentials">
                  <div className="employee-login">{employee.login}</div>
                  <div className="employee-login">{employee.isBlocked ? "заблокирован" : "активен"}</div>
                </div>
              </div>

              <div className="employee-actions">
                <img src="/edit.png" alt="Редактировать" onClick={() => openEditModal(employee as unknown as Employee)} />
                <img src="/lock.png" alt="Блокировать" onClick={() => openBlockModal(employee as unknown as Employee)} />
                <img src="/trash.png" alt="Удалить" onClick={() => openDeleteModal(employee as unknown as Employee)} />
              </div>
            </div>
          ))}
        </div>

        {/* Модальные окна - дочерние компоненты, передаем им 3 пропса: employee, onClose и соответствующий колбэк */}
        {showModalEdit && selectedEmployee && (<EditModal employee={selectedEmployee} onClose={() => setShowModalEdit(false)} onSave={editEmployee} />)}
        {showModalBlock && selectedEmployee && (<BlockModal employee={selectedEmployee} onClose={() => setShowModalBlock(false)} onBlock={toggleBlockEmployee} />)}
        {showModalDelete && selectedEmployee && (<DeleteModal employee={selectedEmployee} onClose={() => setShowModalDelete(false)} onDelete={deleteEmployee} />)}

      </main>
    </div>
  );
}