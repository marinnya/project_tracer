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

type EmployeeData = {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  isBlocked: boolean;
  role: string;
  oneCId: string | null;
};

type Props = {
  onLogout: () => void;
};

type SortField = "name";
type SortDirection = "asc" | "desc";

export default function EmployeesPage({ onLogout }: Props) {
  const [showArchive, setShowArchive] = useState(false);
  const [showModalAdd, setShowModalAdd] = useState(false);
  const [showModalEdit, setShowModalEdit] = useState(false);
  const [showModalBlock, setShowModalBlock] = useState(false);
  const [showModalDelete, setShowModalDelete] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const filterRef = useRef<HTMLDivElement>(null);
  useClickOutside(filterRef as React.RefObject<HTMLElement>, () => setFilterOpen(false));

  const filteredEmployees = employees.filter(emp =>
    showArchive ? emp.isBlocked : !emp.isBlocked
  );

  const sortEmployees = (list: EmployeeData[]) => {
    return [...list].sort((a, b) => {
      const valA = `${a.lastName} ${a.firstName}`.toLowerCase();
      const valB = `${b.lastName} ${b.firstName}`.toLowerCase();
      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  };

  const sortedEmployees = sortEmployees(filteredEmployees);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await api.get<EmployeeData[]>("/users");
      setEmployees(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const openEditModal = (emp: Employee) => { setSelectedEmployee(emp); setShowModalEdit(true); };
  const openBlockModal = (emp: Employee) => { setSelectedEmployee(emp); setShowModalBlock(true); };
  const openDeleteModal = (emp: Employee) => { setSelectedEmployee(emp); setShowModalDelete(true); };

  const addEmployee = async (newEmployee: {
    firstName: string;
    lastName: string;
    login: string;
    password: string;
    role: string;
    oneCId: string;
  }) => {
    try {
      await api.post("/users/", newEmployee);
      await fetchEmployees();
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const editEmployee = async (id: number, updatedData: Partial<EmployeeData>) => {
    try {
      await api.patch(`/users/${id}`, updatedData);
      await fetchEmployees();
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const toggleBlockEmployee = async (id: number, block: boolean) => {
    try {
      await api.patch(`/users/${id}/block`, { value: block });
      await fetchEmployees();
    } catch (err) {
      console.error(err);
    }
  };

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
      <Header onLogout={onLogout} />

      <main className="content">
        <div className="content-header">
          <div className="header-title">
            <h1>Сотрудники</h1>
            <button className="add-icon-btn mobile-only" onClick={() => setShowModalAdd(true)}>
              <img src="/add_circle.png" alt="" />
            </button>
          </div>

          <div className="header-actions desktop-only">
            <button className="add-btn" onClick={() => setShowModalAdd(true)}>
              <img src="/add_circle.png" alt="" />
              <span className="add-text">Добавить сотрудника</span>
            </button>
          </div>

          {showModalAdd && (
            <AddModal
              onClose={() => setShowModalAdd(false)}
              onSave={addEmployee}
              existingOneCIds={employees.map(e => e.oneCId).filter(Boolean) as string[]}
            />
          )}

          <div className="filters desktop-only">
            <button className={!showArchive ? "active" : ""} onClick={() => setShowArchive(false)}>
              Активные
            </button>
            <button className={showArchive ? "active" : ""} onClick={() => setShowArchive(true)}>
              Заблокированные
            </button>
          </div>

          <div className="mobile-only" ref={filterRef}>
            <button className="filter-icon-btn" onClick={() => setFilterOpen((prev) => !prev)}>
              <img src="/filter.png" alt="Фильтр" />
            </button>

            {filterOpen && (
              <div className="filter-dropdown">
                <button
                  className={!showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(false); setFilterOpen(false); }}
                >
                  Активные
                </button>
                <button
                  className={showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(true); setFilterOpen(false); }}
                >
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
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => handleSort("name")}>
                    Фамилия Имя
                    <img
                      src="/arrow_down.png"
                      alt=""
                      className={`arrow ${sortDirection === "desc" ? "open" : ""}`}
                      style={{ marginLeft: 4 }}
                    />
                  </button>
                </th>
                <th>Логин</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="empty-state-table">
                    <div className="spinner" style={{ margin: "16px auto" }} />
                  </td>
                </tr>
              ) : sortedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state-table">
                    {showArchive ? "Нет заблокированных сотрудников" : "Нет активных сотрудников"}
                  </td>
                </tr>
              ) : (
                sortedEmployees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="name">{employee.lastName} {employee.firstName}</td>
                    <td>{employee.login}</td>
                    <td>{employee.isBlocked ? "Заблокирован" : "Активен"}</td>
                    <td className="status-actions">
                      <span className="status edit" onClick={(e) => { e.stopPropagation(); openEditModal(employee as unknown as Employee); }}>
                        Редактировать
                      </span>
                      <span className="status block" onClick={(e) => { e.stopPropagation(); openBlockModal(employee as unknown as Employee); }}>
                        {employee.isBlocked ? "Разблокировать" : "Блокировать"}
                      </span>
                      <span className="status delete" onClick={(e) => { e.stopPropagation(); openDeleteModal(employee as unknown as Employee); }}>
                        Удалить
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="employees-mobile">
          {isLoading ? (
            <div className="empty-state">
              <div className="spinner" style={{ margin: "0 auto" }} />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="empty-state">
              {showArchive ? "Нет заблокированных сотрудников" : "Нет активных сотрудников"}
            </div>
          ) : (
            filteredEmployees.map(employee => (
              <div key={employee.id} className="employee-card">
                <div className="employee-info">
                  <div className="employee-name">{employee.lastName} {employee.firstName}</div>
                  <div className="employee-credentials">
                    <div className="employee-login">{employee.login}</div>
                    <div className="employee-login">{employee.isBlocked ? "заблокирован" : "активен"}</div>
                  </div>
                </div>

                <div className="employee-actions">
                  <img src="/edit.png" alt="" onClick={() => openEditModal(employee as unknown as Employee)} />
                  <img src="/lock.png" alt="" onClick={() => openBlockModal(employee as unknown as Employee)} />
                  <img src="/trash.png" alt="" onClick={() => openDeleteModal(employee as unknown as Employee)} />
                </div>
              </div>
            ))
          )}
        </div>

        {showModalEdit && selectedEmployee && (
          <EditModal employee={selectedEmployee} onClose={() => setShowModalEdit(false)} onSave={editEmployee} />
        )}

        {showModalBlock && selectedEmployee && (
          <BlockModal employee={selectedEmployee} onClose={() => setShowModalBlock(false)} onBlock={toggleBlockEmployee} />
        )}

        {showModalDelete && selectedEmployee && (
          <DeleteModal employee={selectedEmployee} onClose={() => setShowModalDelete(false)} onDelete={deleteEmployee} />
        )}
      </main>
    </div>
  );
}